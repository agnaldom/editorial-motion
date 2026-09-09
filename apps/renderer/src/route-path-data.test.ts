import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routePathData} from './components/RouteReveal';

test('routePathData maps normalized points to layer-local pixels', () => {
  const d = routePathData(
    [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ],
    200,
    100,
  );
  assert.equal(d, 'M 0.00 0.00 L 100.00 100.00 L 200.00 0.00');
});

test('routePathData preserves single-segment paths', () => {
  const d = routePathData(
    [
      [0.25, 0.5],
      [0.75, 0.5],
    ],
    400,
    400,
  );
  assert.equal(d, 'M 100.00 200.00 L 300.00 200.00');
});
