import assert from 'node:assert/strict';
import test from 'node:test';
import {cancelJobRequest, fetchJob, isActive, jobResponseSchema, retryJobRequest, stageIndex, stageLabels} from './job';

test('jobResponseSchema accepts the API contract shape', () => {
  const parsed = jobResponseSchema.parse({
    jobId: 'job_1',
    status: 'processing',
    stage: 'rendering',
    progress: 22,
    stageProgress: 47,
    output: null,
    error: null,
  });
  assert.equal(parsed.stage, 'rendering');
  assert.equal(parsed.stageProgress, 47);
  assert.equal(isActive(parsed.status), true);
});

test('jobResponseSchema rejects malformed payloads', () => {
  assert.throws(() => jobResponseSchema.parse({jobId: 'job_1'}));
});

test('jobResponseSchema parses the API error object with retryable flag', () => {
  const parsed = jobResponseSchema.parse({
    jobId: 'job_1',
    status: 'failed',
    stage: 'rendering',
    progress: 22,
    stageProgress: 40,
    output: null,
    error: {code: 'RENDER_FAILED', message: 'Renderer exited with code 1', retryable: true},
  });
  assert.equal(parsed.error?.code, 'RENDER_FAILED');
  assert.equal(parsed.error?.retryable, true);
  assert.throws(() => jobResponseSchema.parse({...parsed, error: 'Renderer exited with code 1'}));
});

test('retryJobRequest posts to the retry endpoint and returns the refreshed job', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<string> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return new Response(JSON.stringify({
      jobId: 'job_1',
      status: 'processing',
      stage: 'queued',
      progress: 0,
      stageProgress: 0,
      output: null,
      error: null,
    }), {status: 200});
  }) as typeof fetch;
  try {
    const job = await retryJobRequest('job_1');
    assert.equal(job.status, 'processing');
    assert.deepEqual(calls, ['POST /api/v1/renders/job_1/retry', 'GET /api/v1/renders/job_1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stageIndex orders labels and maps unknown stages to pending (-1)', () => {  assert.equal(stageIndex('analyzing'), 0);
  assert.equal(stageIndex('rendering'), stageLabels.length - 1);
  assert.equal(stageIndex('queued'), -1);
});

test('isActive only covers queued/processing', () => {
  assert.equal(isActive('queued'), true);
  assert.equal(isActive('processing'), true);
  assert.equal(isActive('completed'), false);
  assert.equal(isActive('failed'), false);
});

test('fetchJob parses the status endpoint response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    jobId: 'job_1',
    status: 'completed',
    stage: 'completed',
    progress: 100,
    stageProgress: 100,
    output: {fileName: 'scene01.mp4', url: '/api/v1/renders/job_1/output', width: 2560, height: 1440, fps: 30, durationSeconds: 8},
    error: null,
  }), {status: 200})) as typeof fetch;
  try {
    const job = await fetchJob('job_1');
    assert.equal(job.status, 'completed');
    assert.equal(job.output?.fileName, 'scene01.mp4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cancelJobRequest posts to the cancel endpoint and returns the refreshed job (issue #124)', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<string> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return new Response(JSON.stringify({
      jobId: 'job_1',
      status: 'cancelled',
      stage: 'rendering',
      progress: 40,
      stageProgress: 12,
      output: null,
      error: {code: 'CANCELLED', message: 'Render job cancelled by user', retryable: false},
    }), {status: 200});
  }) as typeof fetch;
  try {
    const job = await cancelJobRequest('job_1');
    assert.equal(job.status, 'cancelled');
    assert.equal(job.error?.code, 'CANCELLED');
    assert.equal(isActive(job.status), false);
    assert.deepEqual(calls, ['POST /api/v1/renders/job_1/cancel', 'GET /api/v1/renders/job_1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
