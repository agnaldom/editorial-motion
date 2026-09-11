import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {fileTypeFromBuffer} from 'file-type';
import {renderInputSchema, safeOutputFileName, validateImage} from './input';
import {createRenderJob, retryJob, type RenderJob} from './jobs';
import {LocalJobQueue, MemoryJobRepository, type JobRepository} from './repository';
import {LocalStorageDriver, type StorageDriver} from './storage';
import {processJob, RemotionCliRenderService, type RenderService} from './stages';
import {renderMetrics} from './observability';

const imageExtension: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

type JobQueue = {enqueue(jobId: string): void; close(): Promise<void>};

export type AppOptions = {
  logger?: boolean;
  repository?: JobRepository;
  storage?: StorageDriver;
  queue?: JobQueue;
  renderService?: RenderService;
};

const toJobResponse = (job: RenderJob) => ({
  jobId: job.id,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  stageProgress: job.stageProgress ?? 0,
  output: job.outputAssetKey
    ? {
      fileName: job.outputFileName ?? 'scene01.mp4',
      url: `/api/v1/renders/${job.id}/output`,
      width: job.width,
      height: job.height,
      fps: job.fps,
      durationSeconds: job.durationSeconds,
    }
    : null,
  error: job.error ?? null,
});

export const buildApp = async (options: AppOptions = {}) => {
  const repository = options.repository ?? new MemoryJobRepository();
  const storage = options.storage ?? new LocalStorageDriver();
  const renderService = options.renderService ?? new RemotionCliRenderService();
  const queue: JobQueue = options.queue ?? new LocalJobQueue((jobId) =>
    processJob(jobId, {repository, storage, renderService, log: (event) => app.log.info(event)}));

  const app = Fastify({logger: options.logger ?? true, bodyLimit: 25 * 1024 * 1024, requestTimeout: 120_000});
  await app.register(multipart, {limits: {fileSize: 25 * 1024 * 1024, files: 1}});
  app.addHook('onClose', async () => {
    await queue.close();
  });

  app.post('/api/v1/renders', async (request, reply) => {
    try {
      const parts = request.parts();
      const fields: Record<string, string> = {};
      let image: Buffer | undefined;
      for await (const part of parts) {
        if (part.type === 'file') image = await part.toBuffer();
        else fields[part.fieldname] = String(part.value);
      }
      if (!image) return reply.code(400).send({code: 'INVALID_INPUT', message: 'image is required'});
      await validateImage(image);
      const input = renderInputSchema.parse(fields);
      const detected = await fileTypeFromBuffer(image);
      const jobId = `job_${randomUUID()}`;
      const inputAssetKey = `jobs/${jobId}/input/original${imageExtension[detected?.mime ?? ''] ?? '.img'}`;
      await storage.put(inputAssetKey, image);
      const job = createRenderJob(jobId, {
        prompt: input.prompt,
        durationSeconds: input.durationSeconds,
        width: input.width,
        height: input.height,
        fps: input.fps,
        inputAssetKey,
        outputFileName: safeOutputFileName(input.outputFileName),
        requestId: request.id,
      });
      await repository.save(job);
      queue.enqueue(jobId);
      return reply.code(202).send({jobId, status: job.status, createdAt: job.createdAt});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid render input';
      return reply.code(400).send({code: 'INVALID_INPUT', message});
    }
  });

  app.get('/api/v1/renders/:jobId', async (request, reply) => {
    const {jobId} = request.params as {jobId: string};
    const job = await repository.get(jobId);
    if (!job) return reply.code(404).send({code: 'NOT_FOUND', message: 'Render job not found'});
    return reply.send(toJobResponse(job));
  });

  app.post('/api/v1/renders/:jobId/retry', async (request, reply) => {
    const {jobId} = request.params as {jobId: string};
    const job = await repository.get(jobId);
    if (!job) return reply.code(404).send({code: 'NOT_FOUND', message: 'Render job not found'});
    if (job.status !== 'failed' || !job.error?.retryable) {
      return reply.code(409).send({code: 'NOT_RETRYABLE', message: 'Job is not in a retryable failed state'});
    }
    const retried = retryJob(job);
    await repository.save(retried);
    queue.enqueue(jobId);
    return reply.code(202).send({jobId, status: retried.status, attempt: retried.attempt});
  });

  app.get('/api/v1/renders/:jobId/output', async (request, reply) => {
    const {jobId} = request.params as {jobId: string};
    const job = await repository.get(jobId);
    if (!job?.outputAssetKey || !(await storage.exists(job.outputAssetKey))) {
      return reply.code(404).send({code: 'NOT_FOUND', message: 'Render output not found'});
    }
    const fileName = job.outputFileName ?? 'scene01.mp4';
    reply.header('content-type', 'video/mp4');
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    return reply.send(createReadStream(storage.resolvePath(job.outputAssetKey)));
  });

  app.get('/api/v1/metrics', async (_request, reply) =>
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics.prometheus()));

  app.get('/api/v1/renders/:jobId/analysis', async (request, reply) => {
    if (process.env.DEBUG_ENDPOINTS === 'false') {
      return reply.code(404).send({code: 'NOT_FOUND', message: 'Not found'});
    }
    const {jobId} = request.params as {jobId: string};
    const job = await repository.get(jobId);
    if (!job) return reply.code(404).send({code: 'NOT_FOUND', message: 'Render job not found'});
    const readJson = async (key: string): Promise<unknown> => {
      if (!await storage.exists(key)) return null;
      return JSON.parse((await storage.get(key)).toString('utf8')) as unknown;
    };
    const prefix = `jobs/${jobId}`;
    const analysis = (await readJson(`${prefix}/analysis/scene-analysis.json`)) as {elements?: Array<{maskRef?: string; layerRef?: string}>} | null;
    return reply.send({
      analysis,
      motionPlan: await readJson(`${prefix}/motion/motion-plan.json`),
      artifacts: {
        input: job.inputAssetKey ?? null,
        background: `${prefix}/background/background-clean.png`,
        masks: (analysis?.elements ?? []).map((element) => element.maskRef).filter(Boolean),
        layers: (analysis?.elements ?? []).map((element) => element.layerRef).filter(Boolean),
      },
    });
  });

  return app;
};

if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('server.ts')) {
  buildApp().then((app) => app.listen({port: Number(process.env.PORT ?? 3000), host: '0.0.0.0'})).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
