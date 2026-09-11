import assert from 'node:assert/strict';
import test from 'node:test';
import {createRenderJob, advanceJob} from './jobs';
import {MemoryJobRepository} from './repository';
import {classifyArtifactKey, reconcileInterruptedJobs} from './persistence';

test('classifyArtifactKey mapeia chaves do storage nos tipos do SPEC §25', () => {
  assert.deepEqual(classifyArtifactKey('jobs/job_1/input/original.png'), {jobId: 'job_1', type: 'source'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/masks/elm.png'), {jobId: 'job_1', type: 'mask'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/layers/elm.png'), {jobId: 'job_1', type: 'layer'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/background/background-clean.png'), {jobId: 'job_1', type: 'background'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/analysis/scene-analysis.json'), {jobId: 'job_1', type: 'analysis'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/motion/motion-plan.json'), {jobId: 'job_1', type: 'motion-plan'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/output/scene01.mp4'), {jobId: 'job_1', type: 'video'});
  assert.deepEqual(classifyArtifactKey('jobs/job_1/render-input.json'), {jobId: 'job_1', type: 'debug'});
});

test('reconcileInterruptedJobs: queued retoma, processing falha coerente e retryable', async () => {
  const repository = new MemoryJobRepository();
  const queued = createRenderJob('job_queued');
  const processing = advanceJob(createRenderJob('job_processing'), 'rendering');
  await repository.save(queued);
  await repository.save(processing);
  const requeued: string[] = [];

  const result = await reconcileInterruptedJobs(repository, (jobId) => requeued.push(jobId), async () => [queued, processing]);

  assert.deepEqual(result, {requeued: 1, interrupted: 1});
  assert.deepEqual(requeued, ['job_queued']);
  const failed = await repository.get('job_processing');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.error?.code, 'INTERRUPTED');
  assert.equal(failed?.error?.retryable, true);
  const kept = await repository.get('job_queued');
  assert.equal(kept?.status, 'queued');
});
