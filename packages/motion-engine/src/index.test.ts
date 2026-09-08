import assert from 'node:assert/strict';
import test from 'node:test';
import {easing, resolveLayerState, validateMotionPlan} from './index';

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
  assert.equal(Object.is(state.translateY, -0) ? 0 : state.translateY, 0);
  assert.equal(state.opacity, 1);
});

const scene = {
  version: '1' as const,
  sceneId: 'scene01',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'map' as const,
  elements: [{
    id: 'map', label: 'Map', type: 'map_region' as const, bbox: {x: 0, y: 0, width: 1, height: 1},
    confidence: 1, zIndex: 1, animatable: true, protected: false,
    motionRole: 'primary' as const, source: 'vision' as const,
  }],
  protectedRegions: [{id: 'stats', label: 'Stats', bbox: {x: 0, y: 0.8, width: 1, height: 0.2}, reason: 'reserved'}],
};

const plan = {
  version: '1' as const, sceneId: 'scene01', stylePreset: 'editorial-documentary' as const,
  durationSeconds: 8, fps: 30, canvas: {width: 2560, height: 1440}, camera: {type: 'static' as const},
  events: [], finalHold: {start: 6, duration: 2},
};

test('rejects unknown and protected targets', () => {
  const result = validateMotionPlan({...plan, events: [
    {id: 'unknown', type: 'fade_in' as const, targetId: 'missing', start: 0, duration: 1},
    {id: 'protected', type: 'fade_in' as const, targetId: 'stats', start: 0, duration: 1},
  ]}, scene);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test('enforces camera limits and event duration', () => {
  const result = validateMotionPlan({...plan, camera: {
    type: 'subtle_zoom_in' as const, params: {scaleFrom: 1, scaleTo: 1.1},
  }, events: [{id: 'late', type: 'hold' as const, targetId: 'map', start: 7.5, duration: 1}]}, scene);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});
