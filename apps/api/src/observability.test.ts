import assert from 'node:assert/strict';
import test from 'node:test';
import {actionableError, RenderMetrics} from './observability';

test('aggregates stage duration and failures', () => {
  const metrics = new RenderMetrics();
  metrics.record('rendering', 20);
  metrics.record('rendering', 30, true);
  assert.deepEqual(metrics.snapshot().rendering, {count: 2, failures: 1, elapsedMs: 50});
});

test('normalizes empty error messages', () => {
  assert.equal(actionableError({code: 'FAILED', message: '  '}).message, 'The render job could not be completed.');
});

test('prometheus exposition uses SPEC §31 metric names', () => {
  const metrics = new RenderMetrics();
  metrics.recordJob(5000, false);
  metrics.recordJob(9000, true);
  metrics.record('analyzing', 1200);
  metrics.record('segmenting', 300, true);
  metrics.record('normalizing', 50);
  metrics.recordLlmTokens(42, 17);
  const exposition = metrics.prometheus();
  for (const expected of [
    'render_jobs_total 2',
    'render_jobs_failed_total 1',
    'render_job_duration_seconds_count 2',
    'vision_stage_duration_seconds_count 1',
    'segmentation_stage_duration_seconds_count 1',
    'pipeline_stage_duration_seconds_count{stage="normalizing"} 1',
    'pipeline_stage_failures_total{stage="segmenting"} 1',
    'llm_tokens_input_total 42',
    'llm_tokens_output_total 17',
  ]) {
    assert.ok(exposition.includes(expected), `missing metric line: ${expected}`);
  }
});
