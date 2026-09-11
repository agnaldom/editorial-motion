import assert from 'node:assert/strict';
import test from 'node:test';
import type {MotionPlan} from '@editorial-motion/motion-schema';
import type {SceneElement} from '@editorial-motion/scene-schema';
import {mergeOverlappingElements, normalizePlanForFallbacks, overlapRatio, planFallbacks, pngCoverage, shouldDepthFallback} from './fallback';
import {encodePng, solidMaskPng} from './png';

const element = (id: string, overrides: Partial<SceneElement> = {}): SceneElement => ({
  id,
  label: id,
  type: 'photo',
  bbox: {x: 0, y: 0, width: 0.5, height: 0.5},
  confidence: 1,
  zIndex: 1,
  animatable: true,
  protected: false,
  motionRole: 'primary',
  source: 'vision',
  ...overrides,
});

test('overlapRatio measures coverage of the smaller box', () => {
  const box = {x: 0.1, y: 0.1, width: 0.4, height: 0.4};
  assert.equal(overlapRatio(box, box), 1);
  assert.equal(overlapRatio(box, {x: 0.9, y: 0.9, width: 0.1, height: 0.1}), 0);
  assert.equal(overlapRatio(box, {x: 0.3, y: 0.1, width: 0.4, height: 0.4}), 0.5);
});

test('planFallbacks grades masks into fallback strategies', () => {
  const elements = [
    element('solid', {bbox: {x: 0, y: 0, width: 0.4, height: 0.4}}),
    element('partial', {bbox: {x: 0.5, y: 0, width: 0.4, height: 0.4}, confidence: 0.8}),
    element('empty-confident', {bbox: {x: 0, y: 0.5, width: 0.4, height: 0.4}, confidence: 0.8}),
    element('empty-unreliable', {bbox: {x: 0.5, y: 0.5, width: 0.4, height: 0.4}, confidence: 0.2}),
  ];
  const masks = {
    solid: {coverageRatio: 1},
    partial: {coverageRatio: 0.3},
    'empty-confident': {coverageRatio: 0},
    'empty-unreliable': {coverageRatio: 0.01},
  };
  const strategies = Object.fromEntries(planFallbacks(elements, masks).map((decision) => [decision.targetId, decision.strategy]));
  assert.equal(strategies.solid, undefined); // normal elements emit no decision
  assert.deepEqual(strategies, {
    partial: 'reveal_only',
    'empty-confident': 'region_reveal',
    'empty-unreliable': 'fail',
  });
});

test('planFallbacks marks highly overlapping pairs for merge', () => {
  const elements = [
    element('a', {bbox: {x: 0.1, y: 0.1, width: 0.4, height: 0.4}}),
    element('b', {bbox: {x: 0.2, y: 0.2, width: 0.3, height: 0.3}}),
  ];
  const decisions = planFallbacks(elements, {a: {coverageRatio: 1}, b: {coverageRatio: 1}});
  assert.deepEqual(decisions.map((decision) => decision.strategy), ['merge_group', 'merge_group']);
});

test('mergeOverlappingElements collapses clusters into the union bbox', () => {
  const elements = [
    element('a', {label: 'Map', bbox: {x: 0.1, y: 0.1, width: 0.4, height: 0.4}, confidence: 0.9}),
    element('b', {label: 'Route', bbox: {x: 0.2, y: 0.2, width: 0.3, height: 0.3}, confidence: 0.7}),
    element('static', {animatable: false, bbox: {x: 0.8, y: 0.8, width: 0.1, height: 0.1}}),
  ];
  const {elements: merged, merged: groups} = mergeOverlappingElements(elements);
  assert.deepEqual(groups, {a: ['b']});
  assert.deepEqual(merged.map((item) => item.id), ['a', 'static']);
  const kept = merged.find((item) => item.id === 'a');
  assert.equal(kept?.label, 'Map + Route');
  assert.equal(kept?.confidence, 0.7);
  assert.deepEqual(kept?.bbox, {x: 0.1, y: 0.1, width: 0.4, height: 0.4});
});

const plan = (events: MotionPlan['events']): MotionPlan => ({
  version: '1',
  sceneId: 'scene01',
  stylePreset: 'editorial-documentary',
  durationSeconds: 8,
  fps: 30,
  canvas: {width: 2560, height: 1440},
  camera: {type: 'static'},
  events,
  finalHold: {start: 6, duration: 2},
});

test('normalizePlanForFallbacks rewrites moves on restricted elements into mask reveals', () => {
  const original = plan([
    {id: 'e1', type: 'drop', targetId: 'fragile', start: 0.5, duration: 1, params: {distanceRatio: 0.1, fade: true}},
    {id: 'e2', type: 'fade_in', targetId: 'fragile', start: 2, duration: 1},
    {id: 'e3', type: 'draw_path', targetId: 'fragile', start: 3, duration: 1},
    {id: 'e4', type: 'drop', targetId: 'solid', start: 0.5, duration: 1},
  ]);
  const decisions = [{targetId: 'fragile', strategy: 'reveal_only' as const, reason: 'partial mask'}];
  const normalized = normalizePlanForFallbacks(original, decisions);
  assert.equal(normalized.events[0].type, 'mask_reveal');
  assert.deepEqual(normalized.events[0].params, {});
  assert.equal(normalized.events[1].type, 'fade_in');
  assert.equal(normalized.events[2].type, 'draw_path');
  assert.equal(normalized.events[3].type, 'drop');
  assert.equal(normalizePlanForFallbacks(original, []), original);
});

test('pngCoverage reads solid and partial RGBA masks', () => {
  assert.equal(pngCoverage(solidMaskPng(4, 4)), 1);
  const half = Buffer.alloc(2 * 2 * 4, 255);
  half.fill(0, 2 * 4);
  assert.equal(pngCoverage(encodePng(2, 2, half)), 0.5);
});

test('shouldDepthFallback ativa em cena não dividida', () => {
  assert.equal(shouldDepthFallback([]), true, 'sem elementos');
  assert.equal(shouldDepthFallback([element('full', {bbox: {x: 0, y: 0, width: 1, height: 1}})]), true, 'elemento full-frame único (double legado)');
  assert.equal(shouldDepthFallback([element('tiny', {bbox: {x: 0.1, y: 0.1, width: 0.2, height: 0.2}})]), true, 'cobertura baixa');
  assert.equal(
    shouldDepthFallback([element('a', {bbox: {x: 0, y: 0, width: 0.5, height: 0.6}}), element('b', {bbox: {x: 0.5, y: 0, width: 0.5, height: 0.6}})]),
    false,
    'cena com dois alvos de cobertura razoável',
  );
  assert.equal(shouldDepthFallback([element('a', {animatable: false, protected: true, motionRole: 'protected'})]), true, 'só protected');
});
