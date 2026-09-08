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

test('supports retryable failures and increments attempts', () => {
  const failed = failJob(advanceJob(createRenderJob('job_1'), 'rendering'), 'RENDER_FAILED', 'renderer stopped');
  const retried = retryJob(failed);
  assert.equal(retried.attempt, 1);
  assert.equal(retried.status, 'processing');
});

test('does not retry deterministic failures', () => {
  const failed = failJob(createRenderJob('job_1'), 'INVALID_INPUT', 'bad input', false);
  assert.throws(() => retryJob(failed));
});
