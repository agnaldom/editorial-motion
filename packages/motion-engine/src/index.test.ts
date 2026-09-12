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
  assert.deepEqual(resolveLayerState(0, 30, [event]), {opacity: 0, translateX: 0, translateY: 0, scale: 0.9, revealProgress: 1, clip: null, regions: null});
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
  assert.deepEqual(resolveLayerState(60, 30, events), {opacity: 1, translateX: 0, translateY: 0, scale: 1, revealProgress: 1, clip: null, regions: null});
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

test('step_reveal quantiza o progresso em degraus determinísticos', () => {
  const event = {id: 'steps', type: 'step_reveal' as const, targetId: 'map', start: 0, duration: 4, easing: 'linear' as const, persist: true, params: {steps: 4, direction: 'right'}};
  assert.equal(resolveLayerState(0, 30, [event]).revealProgress, 0);
  assert.equal(resolveLayerState(30, 30, [event]).revealProgress, 0.25, 't=1s → 1º degrau');
  assert.equal(resolveLayerState(60, 30, [event]).revealProgress, 0.5, 't=2s → 2º degrau');
  assert.equal(resolveLayerState(89, 30, [event]).revealProgress, 0.5, 't=2.97s ainda no 2º degrau');
  assert.equal(resolveLayerState(120, 30, [event]).revealProgress, 1);
  assert.deepEqual(resolveLayerState(60, 30, [event]).clip, {kind: 'wipe', direction: 'right'});
});

test('stack desliza para a pilha e unstack assenta no repouso, ordenados por params.order', () => {
  const unstack = {id: 'u', type: 'unstack' as const, targetId: 'a', start: 0, duration: 1, easing: 'linear' as const, persist: true, params: {order: 2, spreadRatio: 0.05, fade: true}};
  assert.equal(resolveLayerState(0, 30, [unstack]).translateX, 0.1);
  assert.equal(resolveLayerState(0, 30, [unstack]).opacity, 0);
  assert.equal(resolveLayerState(30, 30, [unstack]).translateX, 0);
  assert.equal(resolveLayerState(30, 30, [unstack]).opacity, 1);
  const stack = {id: 's', type: 'stack' as const, targetId: 'a', start: 0, duration: 1, easing: 'linear' as const, params: {order: 2, spreadRatio: 0.05}};
  assert.equal(resolveLayerState(0, 30, [stack]).translateX, 0);
  assert.equal(resolveLayerState(30, 30, [stack]).translateX, 0.1);
  assert.equal(resolveLayerState(30, 30, [stack]).translateY, -0.1);
});

test('freeze congela o estado da layer a partir do start', () => {
  const shiftEvent = {id: 'mv', type: 'shift' as const, targetId: 'a', start: 0, duration: 8, easing: 'linear' as const, persist: true, params: {dxRatio: 0.04}};
  const freeze = {id: 'fz', type: 'freeze' as const, targetId: 'a', start: 3, duration: 0.1};
  const events = [shiftEvent, freeze];
  assert.equal(resolveLayerState(240, 30, events).translateX, resolveLayerState(90, 30, events).translateX, 'após freeze, estado = t=3s');
  assert.ok(resolveLayerState(240, 30, events).translateX < 0.04, 'movimento não avança após o congelamento');
});

test('region_reveal acumula janelas com progresso por evento', () => {
  const regions = [
    {id: 'r1', type: 'region_reveal' as const, targetId: 'map', start: 0, duration: 1, easing: 'linear' as const, persist: true, params: {region: {x: 0, y: 0, width: 0.5, height: 1}, direction: 'left'}},
    {id: 'r2', type: 'region_reveal' as const, targetId: 'map', start: 2, duration: 1, easing: 'linear' as const, persist: true, params: {region: {x: 0.5, y: 0, width: 0.5, height: 1}, direction: 'right'}},
  ];
  const before = resolveLayerState(0, 30, regions);
  assert.equal(before.regions?.length, 2);
  assert.equal(before.regions?.[1].progress, 0, 'segunda região ainda fechada');
  const mid = resolveLayerState(75, 30, regions); // t=2.5s: r1 aberta, r2 meio
  assert.equal(mid.regions?.[0].progress, 1);
  assert.equal(mid.regions?.[1].progress, 0.5);
  assert.equal(mid.regions?.[1].direction, 'right');
});

test('validateMotionPlan rejeita params inválidos dos tipos §5.4', () => {
  const base = {...plan, events: []};
  const sceneWithTargets = {...scene, elements: [
    ...scene.elements,
    {id: 'node-b', label: 'B', type: 'icon' as const, bbox: {x: 0.5, y: 0.5, width: 0.2, height: 0.2}, confidence: 0.9, zIndex: 2, animatable: true, protected: false, motionRole: 'secondary' as const, source: 'vision' as const},
  ]};
  const check = (events: unknown[]) => validateMotionPlan({...base, events} as never, sceneWithTargets);
  assert.equal(check([{id: 'c1', type: 'region_reveal', targetId: 'map', start: 0, duration: 1}]).valid, false, 'region ausente');
  assert.equal(check([{id: 'c2', type: 'region_reveal', targetId: 'map', start: 0, duration: 1, params: {region: {x: 0.8, y: 0, width: 0.5, height: 1}}}]).valid, false, 'region fora de 0..1');
  assert.equal(check([{id: 'c3', type: 'connect', targetId: 'map', start: 0, duration: 1}]).valid, false, 'connect sem params.to');
  assert.equal(check([{id: 'c4', type: 'connect', targetId: 'map', start: 0, duration: 1, params: {to: 'missing'}}]).valid, false, 'connect para alvo desconhecido');
  assert.equal(check([{id: 'c5', type: 'connect', targetId: 'map', start: 0, duration: 1, params: {to: 'map'}}]).valid, false, 'connect para si mesmo');
  assert.equal(check([{id: 'c6', type: 'step_reveal', targetId: 'map', start: 0, duration: 1, params: {steps: 1}}]).valid, false, 'steps < 2');
  assert.equal(check([{id: 'c7', type: 'stack', targetId: 'map', start: 0, duration: 1, params: {order: -1}}]).valid, false, 'order negativo');
  assert.equal(check([
    {id: 'ok1', type: 'connect', targetId: 'map', start: 0, duration: 1, params: {to: 'node-b'}},
    {id: 'ok2', type: 'region_reveal', targetId: 'map', start: 0, duration: 1, params: {region: {x: 0, y: 0, width: 0.5, height: 0.5}}},
    {id: 'ok3', type: 'unstack', targetId: 'node-b', start: 0, duration: 1, params: {order: 1}},
    {id: 'ok4', type: 'freeze', targetId: 'map', start: 4, duration: 0.1},
  ]).valid, true);
});
