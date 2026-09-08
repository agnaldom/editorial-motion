import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {randomUUID} from 'node:crypto';
import {renderInputSchema, safeOutputFileName, validateImage} from './input';

const jobs = new Map<string, {jobId: string; status: 'queued'; stage: 'queued'; progress: number; outputFileName: string}>();

export const buildApp = async () => {
  const app = Fastify({logger: true, bodyLimit: 25 * 1024 * 1024, requestTimeout: 120_000});
  await app.register(multipart, {limits: {fileSize: 25 * 1024 * 1024, files: 1}});

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
    const jobId = `job_${randomUUID()}`;
    const job = {jobId, status: 'queued' as const, stage: 'queued' as const, progress: 0, outputFileName: safeOutputFileName(input.outputFileName)};
    jobs.set(jobId, job);
    return reply.code(202).send({jobId, status: job.status, createdAt: new Date().toISOString()});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid render input';
    return reply.code(400).send({code: 'INVALID_INPUT', message});
  }
  });

  app.get('/api/v1/renders/:jobId', async (request, reply) => {
  const {jobId} = request.params as {jobId: string};
  const job = jobs.get(jobId);
  if (!job) return reply.code(404).send({code: 'NOT_FOUND', message: 'Render job not found'});
  return reply.send(job);
  });

  return app;
};

if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('server.ts')) {
  buildApp().then((app) => app.listen({port: Number(process.env.PORT ?? 3000), host: '0.0.0.0'})).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
