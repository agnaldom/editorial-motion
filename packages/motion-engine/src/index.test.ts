import assert from 'node:assert/strict';
import test from 'node:test';
import {easing, resolveLayerState} from './index';

test('uses editorial easing without overshoot', () => {
  assert.equal(easing('editorialOut', 0), 0);
  assert.equal(easing('editorialOut', 1), 1);
  assert.ok(easing('editorialOut', 0.5) > 0.5);
  assert.ok(easing('editorialOut', 0.5) <= 1);
});

test('resolves a persistent fade event by frame', () => {
  const event = {id: 'fade', type: 'fade_in' as const, targetId: 'map', start: 1, duration: 1, easing: 'linear' as const, persist: true};
  assert.equal(resolveLayerState(15, 30, [event]).opacity, 0);
  assert.equal(resolveLayerState(45, 30, [event]).opacity, 0.5);
  assert.equal(resolveLayerState(90, 30, [event]).opacity, 1);
});

test('composes a drop with fade and reaches the original landing state', () => {
  const event = {id: 'drop', type: 'drop' as const, targetId: 'map', start: 0, duration: 1, easing: 'linear' as const, persist: true, params: {distanceRatio: 0.1, fade: true}};
  const state = resolveLayerState(30, 30, [event]);
  assert.equal(state.translateY, 0);
  assert.equal(state.opacity, 1);
});
