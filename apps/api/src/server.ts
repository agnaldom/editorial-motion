import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {fileTypeFromBuffer} from 'file-type';
import {renderInputSchema, safeOutputFileName, validateImage} from './input';
import {createRenderJob, retryJob, cancelJob, type RenderJob} from './jobs';
import {LocalJobQueue, MemoryJobRepository, type JobRepository} from './repository';
import {LocalStorageDriver, type StorageDriver} from './storage';
import {CancellationRegistry} from './cancellations';
import {analyzeScene, type SemanticVisionProvider} from './scene-analyzer';
import {createSceneAnalyzer, createMotionPlanner} from './llm-providers';
import {createMotionPlan, type MotionPlannerProvider} from './motion-planner';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import {classifyLayerability, enrichSceneGraph, sceneAnalysisToSceneGraph, validateSceneGraph} from '@editorial-motion/scene-schema';
import {scoreStrategies} from '@editorial-motion/motion-strategies';
import {SUPPORTED_MOTION_TYPES} from './motion-vocabulary';
import {closeSharedVisionCache} from './cache';
import {processJob, RemotionCliRenderService, type RenderService} from './stages';
import {codeOf, httpStatusFor, type ErrorCode} from './errors';
import {SqlArtifactRepository, SqlJobRepository, AuditedStorageDriver, reconcileInterruptedJobs} from './persistence';
import {RedisJobQueue} from './redis-queue';
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
  cancellations?: CancellationRegistry;
  databaseUrl?: string;
  redisUrl?: string;
  analyzer?: SemanticVisionProvider;
  motionPlanner?: MotionPlannerProvider;
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
  // Persistência opt-in (issue #125, SPEC §7.7): sem DATABASE_URL/REDIS_URL o
  // comportamento é o V1 (memória + fila in-process).
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const sqlRepository = databaseUrl ? new SqlJobRepository(databaseUrl) : undefined;
  if (sqlRepository) await sqlRepository.ensureSchema();
  const repository = options.repository ?? sqlRepository ?? new MemoryJobRepository();

  const baseStorage = options.storage ?? new LocalStorageDriver();
  const artifactRepository = databaseUrl ? new SqlArtifactRepository(databaseUrl) : undefined;
  if (artifactRepository) await artifactRepository.ensureSchema();
  const storage = artifactRepository ? new AuditedStorageDriver(baseStorage, artifactRepository) : baseStorage;

  const renderService = options.renderService ?? new RemotionCliRenderService();
  const cancellations = options.cancellations ?? new CancellationRegistry();
  const jobHandler = (jobId: string) =>
    processJob(jobId, {repository, storage, renderService, log: (event) => app.log.info(event), cancellations, analyzer: options.analyzer, motionPlanner: options.motionPlanner});
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  const redisQueue = redisUrl ? new RedisJobQueue(jobHandler, redisUrl) : undefined;
  if (redisQueue) await redisQueue.recover();
  const queue: JobQueue = options.queue ?? redisQueue ?? new LocalJobQueue(jobHandler);

  // Sem órfãos após restart (issue #125): queued retoma, processing falha coerente.
  if (sqlRepository) {
    await reconcileInterruptedJobs(repository, (jobId) => queue.enqueue(jobId), () => sqlRepository.activeJobs());
  }

  const app = Fastify({logger: options.logger ?? true, bodyLimit: 25 * 1024 * 1024, requestTimeout: 120_000});
  await app.register(multipart, {limits: {fileSize: 25 * 1024 * 1024, files: 1}});
  app.addHook('onClose', async () => {
    await queue.close();
    await redisQueue?.close();
    await sqlRepository?.close();
    await artifactRepository?.close();
    await closeSharedVisionCache();
  });

  // SPEC V2 §53 (issue #153): análise e planejamento síncronos, sem job.
  app.post('/api/v1/analyze', async (request, reply) => {
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
      const analyzer = options.analyzer ?? createSceneAnalyzer();
      const analysis = await analyzeScene(analyzer, image, fields.prompt ?? 'Analyze this composition');
      const sceneGraph = enrichSceneGraph(sceneAnalysisToSceneGraph(analysis));
      const graphValidation = validateSceneGraph(sceneGraph);
      return reply.send({
        analysis,
        sceneGraph,
        graphValidation,
        layerability: sceneGraph.elements.map((element) => ({
          id: element.id,
          layerability: element.layerability,
          decision: classifyLayerability(element.layerability),
        })),
        strategyCandidates: scoreStrategies(sceneGraph),
      });
    } catch (error) {
      const code = codeOf(error) ?? 'SCENE_ANALYSIS_FAILED';
      const status = httpStatusFor[code as ErrorCode] ?? 500;
      return reply.code(status).send({code, message: error instanceof Error ? error.message : 'Analysis failed'});
    }
  });

  app.post('/api/v1/plan', async (request, reply) => {
    try {
      const body = request.body as {prompt?: string; durationSeconds?: number; fps?: number; width?: number; height?: number; sceneAnalysis?: unknown};
      if (!body?.prompt?.trim()) return reply.code(400).send({code: 'PROMPT_EMPTY', message: 'prompt is required'});
      if (!body.sceneAnalysis) return reply.code(400).send({code: 'INVALID_INPUT', message: 'sceneAnalysis is required'});
      const planner = options.motionPlanner ?? createMotionPlanner();
      const plan = await createMotionPlan(planner, {
        prompt: body.prompt,
        durationSeconds: body.durationSeconds ?? 8,
        fps: body.fps ?? 30,
        canvas: {width: body.width ?? 2560, height: body.height ?? 1440},
        sceneAnalysis: body.sceneAnalysis as never,
        allowedMotionTypes: [...SUPPORTED_MOTION_TYPES],
      });
      const validation = validateMotionPlan(plan, body.sceneAnalysis as never);
      return reply.send({plan, validation});
    } catch (error) {
      const code = codeOf(error) ?? 'MOTION_PLAN_FAILED';
      const status = httpStatusFor[code as ErrorCode] ?? 500;
      return reply.code(status).send({code, message: error instanceof Error ? error.message : 'Planning failed'});
    }
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
      if (!fields.prompt || !fields.prompt.trim()) {
        return reply.code(400).send({code: 'PROMPT_EMPTY', message: 'prompt is required'});
      }
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
        debug: input.debug,
        requestId: request.id,
      });
      await repository.save(job);
      queue.enqueue(jobId);
      return reply.code(202).send({jobId, status: job.status, createdAt: job.createdAt});
    } catch (error) {
      const code = codeOf(error) ?? 'INVALID_INPUT';
      const status = httpStatusFor[code as ErrorCode] ?? 400;
      const message = error instanceof Error ? error.message : 'Invalid render input';
      return reply.code(status).send({code, message});
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

  // Cancelamento cooperativo (issue #124): queued cancela na hora; processing
  // cancela após o stage em andamento (flag verificada entre stages).
  app.post('/api/v1/renders/:jobId/cancel', async (request, reply) => {
    const {jobId} = request.params as {jobId: string};
    const job = await repository.get(jobId);
    if (!job) return reply.code(404).send({code: 'NOT_FOUND', message: 'Render job not found'});
    if (job.status === 'queued') {
      cancellations.request(jobId);
      const cancelled = cancelJob(job);
      await repository.save(cancelled);
      return reply.code(202).send({jobId, status: cancelled.status});
    }
    if (job.status === 'processing') {
      cancellations.request(jobId);
      return reply.code(202).send({jobId, status: job.status});
    }
    return reply.code(409).send({code: 'NOT_RETRYABLE', message: 'Job is not active (queued or processing)'});
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
