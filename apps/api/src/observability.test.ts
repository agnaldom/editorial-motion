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
