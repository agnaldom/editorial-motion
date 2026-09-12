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

test('maps input errors to the SPEC §18 catalog (PROMPT_EMPTY, UNSUPPORTED_IMAGE)', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());
  const buildBody = (fields: Record<string, string>, imageBytes?: Buffer): Buffer => {
    const parts = Object.entries(fields).map(
      ([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
    if (imageBytes) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source.png"\r\nContent-Type: image/png\r\n\r\n`);
      return Buffer.concat([Buffer.from(parts.join('')), imageBytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    }
    return Buffer.from(`${parts.join('')}--${boundary}--\r\n`);
  };
  const post = (payload: Buffer) => app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload,
  });

  const emptyPrompt = await post(buildBody({prompt: '   '}, image));
  assert.equal(emptyPrompt.statusCode, 400);
  assert.equal(emptyPrompt.json().code, 'PROMPT_EMPTY');

  const unsupported = await post(buildBody({prompt: 'Reveal the map'}, Buffer.from('GIF89a123')));
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json().code, 'UNSUPPORTED_IMAGE');
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

test('POST cancel: queued cancela antes do processamento; processing e finalizados rejeitados (issue #124)', async (t) => {
  const repository = new MemoryJobRepository();
  const enqueued: string[] = [];
  const app = await buildApp({
    logger: false,
    repository,
    queue: {enqueue: (jobId: string) => enqueued.push(jobId), close: async () => undefined},
  });
  t.after(() => app.close());

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: multipartRenderBody(),
  });
  const {jobId} = create.json() as {jobId: string};
  assert.equal(enqueued.length, 1);

  const cancel = await app.inject({method: 'POST', url: `/api/v1/renders/${jobId}/cancel`});
  assert.equal(cancel.statusCode, 202);
  assert.equal(cancel.json().status, 'cancelled');

  const after = await app.inject({method: 'GET', url: `/api/v1/renders/${jobId}`});
  assert.equal(after.json().status, 'cancelled');
  assert.equal(after.json().error.code, 'CANCELLED');
  assert.equal(after.json().error.retryable, false);

  const again = await app.inject({method: 'POST', url: `/api/v1/renders/${jobId}/cancel`});
  assert.equal(again.statusCode, 409);

  const processing = advanceJob(createRenderJob('job_processing'), 'validating');
  await repository.save(processing);
  const cancelProcessing = await app.inject({method: 'POST', url: '/api/v1/renders/job_processing/cancel'});
  assert.equal(cancelProcessing.statusCode, 202);
  assert.equal(cancelProcessing.json().status, 'processing');

  const completed = advanceJob(createRenderJob('job_done'), 'completed');
  await repository.save(completed);
  const cancelCompleted = await app.inject({method: 'POST', url: '/api/v1/renders/job_done/cancel'});
  assert.equal(cancelCompleted.statusCode, 409);

  const missing = await app.inject({method: 'POST', url: '/api/v1/renders/job_missing/cancel'});
  assert.equal(missing.statusCode, 404);
});

test('POST /api/v1/analyze retorna grafo, layerability e candidatos de strategy (issue #153)', async (t) => {
  const analyzer = {
    analyze: async () => ({
      version: '1',
      sceneId: 'scene01',
      source: {width: 1280, height: 720, aspectRatio: 16 / 9},
      compositionType: 'editorial-collage',
      classifications: [{type: 'editorial-collage', confidence: 0.84}],
      elements: [
        {id: 'a', label: 'A', type: 'cutout', bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.4}, confidence: 0.9, zIndex: 1, animatable: true, protected: false, motionRole: 'primary', source: 'vision', layerability: 0.9},
        {id: 'b', label: 'B', type: 'cutout', bbox: {x: 0.5, y: 0.2, width: 0.3, height: 0.4}, confidence: 0.9, zIndex: 2, animatable: true, protected: false, motionRole: 'secondary', source: 'vision', layerability: 0.88},
        {id: 'c', label: 'C', type: 'cutout', bbox: {x: 0.3, y: 0.55, width: 0.3, height: 0.3}, confidence: 0.9, zIndex: 3, animatable: true, protected: false, motionRole: 'secondary', source: 'vision', layerability: 0.86},
      ],
      protectedRegions: [],
    }),
  };
  const app = await buildApp({logger: false, analyzer});
  t.after(() => app.close());

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nAssemble the plates\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source.png"\r\nContent-Type: image/png\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/analyze',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: body,
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as {
    sceneGraph: {version: string; elements: unknown[]};
    graphValidation: {valid: boolean};
    layerability: Array<{id: string; decision: string}>;
    strategyCandidates: {selected: string};
  };
  assert.equal(payload.sceneGraph.version, '2');
  assert.equal(payload.graphValidation.valid, true);
  assert.equal(payload.layerability.length, 3);
  assert.equal(payload.layerability[0].decision, 'layer');
  assert.equal(payload.strategyCandidates.selected, 'disassemble-reassemble');

  const bad = await app.inject({
    method: 'POST',
    url: '/api/v1/analyze',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nx\r\n--${boundary}--\r\n`),
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, 'INVALID_INPUT');
});

test('POST /api/v1/plan devolve plano validado a partir do sceneAnalysis (issue #153)', async (t) => {
  const app = await buildApp({logger: false, queue: {enqueue: () => undefined, close: async () => undefined}});
  t.after(() => app.close());
  const sceneAnalysis = {
    version: '1',
    sceneId: 'scene01',
    source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
    compositionType: 'map',
    classifications: [{type: 'map', confidence: 0.9}],
    elements: [
      {id: 'plate', label: 'Plate', type: 'map_region', bbox: {x: 0.1, y: 0.1, width: 0.4, height: 0.5}, confidence: 0.9, zIndex: 1, animatable: true, protected: false, motionRole: 'primary', source: 'vision'},
      {id: 'route', label: 'Route', type: 'route', bbox: {x: 0.2, y: 0.6, width: 0.6, height: 0.1}, confidence: 0.9, zIndex: 2, animatable: true, protected: false, motionRole: 'connector', source: 'vision'},
    ],
    protectedRegions: [],
  };

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/plan',
    payload: {prompt: 'Separate the plates then draw the routes', durationSeconds: 8, sceneAnalysis},
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as {plan: {events: Array<{type: string}>}; validation: {valid: boolean}};
  assert.equal(payload.validation.valid, true);
  assert.ok(payload.plan.events.length >= 2);

  const noPrompt = await app.inject({method: 'POST', url: '/api/v1/plan', payload: {sceneAnalysis}});
  assert.equal(noPrompt.statusCode, 400);
  assert.equal(noPrompt.json().code, 'PROMPT_EMPTY');

  const noAnalysis = await app.inject({method: 'POST', url: '/api/v1/plan', payload: {prompt: 'Move'}});
  assert.equal(noAnalysis.statusCode, 400);
  assert.equal(noAnalysis.json().code, 'INVALID_INPUT');
});
