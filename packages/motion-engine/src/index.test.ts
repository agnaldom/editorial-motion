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

test('assemble enters with fade and gentle scale from 0.9', () => {
  const event = {id: 'assemble', type: 'assemble' as const, targetId: 'chart', start: 1, duration: 1, easing: 'linear' as const, persist: true};
  assert.deepEqual(resolveLayerState(0, 30, [event]), {opacity: 0, translateX: 0, translateY: 0, scale: 0.9, revealProgress: 1, clip: null});
  const mid = resolveLayerState(45, 30, [event]);
  assert.equal(mid.opacity, 0.5);
  assert.ok(Math.abs(mid.scale - 0.95) < 1e-9);
  const end = resolveLayerState(60, 30, [event]);
  assert.equal(end.opacity, 1);
  assert.equal(end.scale, 1);
});

test('shift moves the layer to a new resting offset only while persisted', () => {
  const event = {id: 'shift', type: 'shift' as const, targetId: 'legend', start: 1, duration: 1, easing: 'linear' as const, persist: true, params: {dxRatio: 0.1, dyRatio: -0.05}};
  assert.equal(resolveLayerState(45, 30, [event]).translateX, 0.05);
  const end = resolveLayerState(60, 30, [event]);
  assert.equal(end.translateX, 0.1);
  assert.equal(end.translateY, -0.05);
  const transient = {...event, persist: false};
  assert.equal(resolveLayerState(90, 30, [transient]).translateX, 0);
});

test('separate_layers spreads each layer along its own direction', () => {
  const up = {id: 'sep', type: 'separate_layers' as const, targetId: 'a', start: 0, duration: 1, easing: 'linear' as const, persist: true, params: {direction: 'up', distanceRatio: 0.1}};
  const right = {...up, targetId: 'b', params: {direction: 'right', distanceRatio: 0.1}};
  assert.equal(resolveLayerState(30, 30, [up]).translateY, -0.1);
  assert.equal(resolveLayerState(30, 30, [right]).translateX, 0.1);
});

test('hold and overlays leave layer state untouched', () => {
  const events = [
    {id: 'hold', type: 'hold' as const, targetId: 'map', start: 1, duration: 2},
    {id: 'hl', type: 'highlight' as const, targetId: 'map', start: 1, duration: 1, persist: true},
    {id: 'ul', type: 'underline' as const, targetId: 'map', start: 1, duration: 1, persist: true},
    {id: 'ce', type: 'circle_emphasis' as const, targetId: 'map', start: 1, duration: 1, persist: true},
  ];
  assert.deepEqual(resolveLayerState(60, 30, events), {opacity: 1, translateX: 0, translateY: 0, scale: 1, revealProgress: 1, clip: null});
});

test('reveal events hide the layer before their start', () => {
  const wipe = {id: 'wipe', type: 'wipe_reveal' as const, targetId: 'map', start: 1, duration: 1, easing: 'linear' as const, persist: true};
  assert.equal(resolveLayerState(0, 30, [wipe]).revealProgress, 0);
  assert.equal(resolveLayerState(15, 30, [wipe]).revealProgress, 0);
  assert.equal(resolveLayerState(45, 30, [wipe]).revealProgress, 0.5);
  assert.equal(resolveLayerState(60, 30, [wipe]).revealProgress, 1);
});

test('wipe_reveal carries direction and mask_reveal uses a center clip', () => {
  const wipe = {id: 'wipe', type: 'wipe_reveal' as const, targetId: 'map', start: 0, duration: 1, easing: 'linear' as const, persist: true, params: {direction: 'right'}};
  const masked = {id: 'mask', type: 'mask_reveal' as const, targetId: 'map', start: 0, duration: 1, easing: 'linear' as const, persist: true};
  assert.deepEqual(resolveLayerState(30, 30, [wipe]).clip, {kind: 'wipe', direction: 'right'});
  assert.deepEqual(resolveLayerState(30, 30, [masked]).clip, {kind: 'mask', direction: 'center'});
  // draw_path preserva o visual legado de revelação da esquerda para a direita
  const draw = {id: 'draw', type: 'draw_path' as const, targetId: 'map', start: 0, duration: 1, easing: 'linear' as const, persist: true};
  assert.deepEqual(resolveLayerState(30, 30, [draw]).clip, {kind: 'wipe', direction: 'left'});
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
