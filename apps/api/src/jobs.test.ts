import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceJob, createRenderJob, failJob, retryJob} from './jobs';

test('advances a job through ordered stages', () => {
  const job = advanceJob(advanceJob(createRenderJob('job_1'), 'validating'), 'normalizing');
  assert.equal(job.status, 'processing');
  assert.equal(job.progress > 0, true);
});

test('rejects backwards transitions and advances completed jobs to 100%', () => {
  const job = advanceJob(createRenderJob('job_1'), 'rendering');
  assert.throws(() => advanceJob(job, 'analyzing'));
  assert.equal(advanceJob(job, 'completed').progress, 100);
});

test('weights rendering as the dominant slice of overall progress', () => {
  const rendering = advanceJob(createRenderJob('job_1'), 'rendering');
  const verifying = advanceJob(rendering, 'verifying_output');
  assert.equal(rendering.stageProgress, 0);
  assert.equal(rendering.progress < 50, true, `rendering starts at ${rendering.progress}%`);
  assert.equal(verifying.progress > rendering.progress, true);
  assert.equal(verifying.progress < 100, true);
});

test('supports retryable failures and increments attempts', () => {
  const failed = failJob(advanceJob(createRenderJob('job_1'), 'rendering'), 'RENDER_FAILED', 'renderer stopped');
  const retried = retryJob(failed);
  assert.equal(retried.attempt, 1);
  assert.equal(retried.status, 'processing');
  assert.equal(retried.stage, 'queued');
  assert.equal(retried.progress, 0);
  assert.equal(retried.error, undefined);
});

test('does not retry deterministic failures', async () => {
  const failed = failJob(createRenderJob('job_1'), 'INVALID_INPUT', 'bad input', {retryable: false});
  assert.throws(() => retryJob(failed));
});

test('failed jobs carry the canonical error shape (code, message, retryable, stage, details)', async () => {
  const failed = failJob(advanceJob(createRenderJob('job_1'), 'rendering'), 'RENDER_FAILED', 'renderer stopped', {
    details: {exitCode: 1},
  });
  assert.equal(failed.error?.stage, 'rendering');
  assert.equal(failed.error?.retryable, true);
  assert.deepEqual(failed.error?.details, {exitCode: 1});
});
