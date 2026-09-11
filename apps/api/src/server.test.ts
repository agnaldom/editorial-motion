import assert from 'node:assert/strict';
import test from 'node:test';
import {buildApp} from './server';
import {advanceJob, createRenderJob, failJob} from './jobs';
import {MemoryJobRepository} from './repository';

const boundary = 'editorial-motion-test-boundary';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function multipartRenderBody(prompt = 'Reveal the map') {
  const fields = [
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="durationSeconds"\r\n\r\n8\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="outputFileName"\r\n\r\nscene final.mp4\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source.png"\r\nContent-Type: image/png\r\n\r\n`,
  ];
  return Buffer.concat([
    Buffer.from(fields.join('')),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test('creates and retrieves a render job through the HTTP API', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: multipartRenderBody(),
  });

  assert.equal(create.statusCode, 202);
  const created = create.json() as {jobId: string; status: string};
  assert.match(created.jobId, /^job_/);
  assert.equal(created.status, 'queued');

  const get = await app.inject({method: 'GET', url: `/api/v1/renders/${created.jobId}`});
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().jobId, created.jobId);
  assert.equal(get.json().output, null);
});

test('returns not found for render output of an unfinished job', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: multipartRenderBody(),
  });
  const {jobId} = create.json() as {jobId: string};

  const output = await app.inject({method: 'GET', url: `/api/v1/renders/${jobId}/output`});
  assert.equal(output.statusCode, 404);
});

test('rejects a render request without an image', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: Buffer.from(`--${boundary}--\r\n`),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_INPUT');
});

test('returns not found for an unknown render job', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const response = await app.inject({method: 'GET', url: '/api/v1/renders/job_missing'});

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'NOT_FOUND');
});

test('GET /api/v1/metrics exposes Prometheus exposition', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());
  const response = await app.inject({method: 'GET', url: '/api/v1/metrics'});
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.match(response.body, /render_jobs_total \d+/);
});

const retryableFailedJob = () =>
  failJob(advanceJob(createRenderJob('job_retry', {prompt: 'Reveal the map'}), 'rendering'), 'RENDER_FAILED', 'renderer stopped');

test('POST retry re-enqueues a retryable failed job', async (t) => {
  const repository = new MemoryJobRepository();
  await repository.save(retryableFailedJob());
  const enqueued: string[] = [];
  const app = await buildApp({
    logger: false,
    repository,
    queue: {enqueue: (jobId) => enqueued.push(jobId), close: async () => undefined},
  });
  t.after(() => app.close());

  const response = await app.inject({method: 'POST', url: '/api/v1/renders/job_retry/retry'});
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().attempt, 1);
  assert.deepEqual(enqueued, ['job_retry']);

  const after = await app.inject({method: 'GET', url: '/api/v1/renders/job_retry'});
  assert.equal(after.json().status, 'processing');
  assert.equal(after.json().stage, 'queued');
  assert.equal(after.json().progress, 0);
});

test('POST retry rejects non-retryable states', async (t) => {
  const repository = new MemoryJobRepository();
  await repository.save(retryableFailedJob()); // retryable failure
  await repository.save(createRenderJob('job_active'));
  const app = await buildApp({logger: false, repository, queue: {enqueue: () => undefined, close: async () => undefined}});
  t.after(() => app.close());

  const active = await app.inject({method: 'POST', url: '/api/v1/renders/job_active/retry'});
  assert.equal(active.statusCode, 409);
  assert.equal(active.json().code, 'NOT_RETRYABLE');

  const missing = await app.inject({method: 'POST', url: '/api/v1/renders/job_missing/retry'});
  assert.equal(missing.statusCode, 404);

  await app.inject({method: 'POST', url: '/api/v1/renders/job_retry/retry'});
  const secondRetry = await app.inject({method: 'POST', url: '/api/v1/renders/job_retry/retry'});
  assert.equal(secondRetry.statusCode, 409, 'job is processing again, not retryable');
});
