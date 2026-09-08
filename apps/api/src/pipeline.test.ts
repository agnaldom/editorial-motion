import assert from 'node:assert/strict';
import test from 'node:test';
import {createRenderJob} from './jobs';
import {runPipeline} from './pipeline';

const context = {image: Buffer.from('image'), prompt: 'Move map', artifacts: {}};

test('runs ordered stages and reports completion', async () => {
  const progress: string[] = [];
  const result = await runPipeline(createRenderJob('job_1'), context, {
    validating: async (value) => ({...value, artifacts: {...value.artifacts, validated: true}}),
    rendering: async (value) => ({...value, artifacts: {...value.artifacts, output: 'scene01.mp4'}}),
  }, (job) => progress.push(job.stage));
  assert.equal(result.job.status, 'completed');
  assert.equal(result.job.progress, 100);
  assert.deepEqual(result.context.artifacts, {validated: true, output: 'scene01.mp4'});
  assert.equal(progress[0], 'validating');
  assert.equal(progress.at(-1), 'completed');
});

test('fails with the current job state when a stage throws', async () => {
  let failedJob;
  await assert.rejects(() => runPipeline(createRenderJob('job_1'), context, {
    analyzing: async () => { throw new Error('provider unavailable'); },
  }, (job) => { if (job.status === 'failed') failedJob = job; }));
  assert.equal(failedJob?.stage, 'analyzing');
  assert.equal(failedJob?.error?.retryable, true);
});
