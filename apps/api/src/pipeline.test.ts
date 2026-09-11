import assert from 'node:assert/strict';
import test from 'node:test';
import {createRenderJob} from './jobs';
import {RenderMetrics} from './observability';
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

test('retry por estágio: falha 1x em estágio retryable recupera (SPEC §26)', async () => {
  const events: Array<Record<string, unknown>> = [];
  let calls = 0;
  const result = await runPipeline(createRenderJob('job_retry'), context, {
    analyzing: async (value) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('vision gateway flaked'), {code: 'SCENE_ANALYSIS_FAILED'});
      return {...value, artifacts: {...value.artifacts, analyzed: true}};
    },
  }, undefined, undefined, {log: (event) => events.push(event)});
  assert.equal(result.job.status, 'completed');
  assert.equal(calls, 2);
  assert.ok(events.some((event) => event.willRetry === true && event.attempt === 1 && event.stage === 'analyzing'));
  assert.ok(events.some((event) => event.success === true && event.attempt === 2));
});

test('erro determinístico não é re-tentado', async () => {
  let calls = 0;
  let failedJob;
  await assert.rejects(() => runPipeline(createRenderJob('job_det'), context, {
    analyzing: async () => {
      calls += 1;
      throw Object.assign(new Error('plan invalid'), {code: 'MOTION_PLAN_INVALID'});
    },
  }, (job) => { if (job.status === 'failed') failedJob = job; }));
  assert.equal(calls, 1, 'validação determinística não pode re-tentar');
  assert.equal(failedJob?.error?.code, 'MOTION_PLAN_INVALID');
});

test('job falha após esgotar as tentativas do estágio', async () => {
  let calls = 0;
  let failedJob;
  await assert.rejects(() => runPipeline(createRenderJob('job_exhaust'), context, {
    rendering: async () => {
      calls += 1;
      throw Object.assign(new Error('renderer crashed'), {code: 'RENDER_FAILED'});
    },
  }, (job) => { if (job.status === 'failed') failedJob = job; }));
  assert.equal(calls, 2, 'render tem 2 tentativas (SPEC §26)');
  assert.equal(failedJob?.error?.code, 'RENDER_FAILED');
  assert.equal((failedJob?.error?.details as {stageAttempts: number}).stageAttempts, 2);
});

test('cancelamento: flag verificada entre stages, job cancelado sem métrica de falha (issue #124)', async () => {
  const metrics = new RenderMetrics();
  const stagesRan: string[] = [];
  let sawCancelled: RenderJob | undefined;
  await assert.rejects(() => runPipeline(
    createRenderJob('job_cancel'),
    context,
    {
      validating: async (value) => { stagesRan.push('validating'); return value; },
      analyzing: async (value) => { stagesRan.push('analyzing'); return value; },
    },
    (job) => { if (job.status === 'cancelled') sawCancelled = job; },
    undefined,
    {metrics, isCancelled: () => stagesRan.length === 1},
  ));
  assert.deepEqual(stagesRan, ['validating'], 'pipeline para após o stage em andamento');
  assert.equal(sawCancelled?.status, 'cancelled');
  assert.equal(sawCancelled?.error?.code, 'CANCELLED');
  assert.equal(sawCancelled?.error?.retryable, false);
  assert.match(metrics.prometheus(), /render_jobs_failed_total 0/, 'cancelado não é falha de pipeline');
});
