import assert from 'node:assert/strict';
import test from 'node:test';
import {motionEventTypeSchema} from '@editorial-motion/motion-schema';
import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import {DeterministicMotionPlanner} from './doubles';
import {createMotionPlan} from './motion-planner';
import {
  appliesTo,
  gestureNotesForPrompt,
  gesturesForPrompt,
  primaryGestureForPrompt,
  SUPPORTED_MOTION_TYPES,
} from './motion-vocabulary';

test('SUPPORTED_MOTION_TYPES reflete exatamente os tipos do schema', () => {
  const schemaTypes = motionEventTypeSchema.options;
  assert.deepEqual([...SUPPORTED_MOTION_TYPES].sort(), [...schemaTypes].sort());
});

test('tabela verbo→gesto cobre os verbos do escopo', () => {
  assert.deepEqual(gesturesForPrompt('Assemble the map plates').map((hint) => hint.types[0]), ['assemble']);
  assert.deepEqual(gesturesForPrompt('Draw the gold routes')[0].types, ['draw_path', 'draw_arrow']);
  assert.deepEqual(gesturesForPrompt('Reveal the regions from left to right')[0].types, ['mask_reveal', 'wipe_reveal']);
  assert.deepEqual(gesturesForPrompt('Highlight the capital and freeze')[0].types, ['highlight', 'circle_emphasis']);
  assert.ok(gesturesForPrompt('Lock the routes').some((hint) => hint.types.length === 0));
  assert.deepEqual(gestureNotesForPrompt(''), []);
});

const element = (overrides: Record<string, unknown>) => ({
  id: 'el', label: 'El', type: 'map_region', bbox: {x: 0, y: 0, width: 1, height: 1},
  confidence: 1, zIndex: 1, animatable: true, protected: false,
  motionRole: 'primary', source: 'vision', ...overrides,
}) as never;

test('appliesTo restringe draw a route/arrow e bloqueia protected/static', () => {
  assert.equal(appliesTo('draw_path', element({type: 'route'})), true);
  assert.equal(appliesTo('draw_path', element({type: 'map_region'})), false);
  assert.equal(appliesTo('fade_in', element({protected: true})), false);
  assert.equal(appliesTo('fade_in', element({motionRole: 'static'})), false);
  assert.equal(appliesTo('hold', element({})), false);
});

test('primaryGestureForPrompt resolve o primeiro gesto aplicável e preserva drop como default', () => {
  assert.equal(primaryGestureForPrompt('Draw the routes', element({type: 'route'})), 'draw_path');
  assert.equal(primaryGestureForPrompt('Draw the routes', element({type: 'map_region'})), 'drop');
  assert.equal(primaryGestureForPrompt('Separate the paper layers', element({})), 'separate_layers');
  assert.equal(primaryGestureForPrompt('Animate this', element({})), 'drop');
});

const scene: SceneAnalysis = {
  version: '1',
  sceneId: 'scene01',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'map',
  elements: [
    {id: 'plate-a', label: 'Plate A', type: 'map_region', bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.3}, confidence: 0.9, zIndex: 1, animatable: true, protected: false, motionRole: 'primary', source: 'vision'},
    {id: 'plate-b', label: 'Plate B', type: 'map_region', bbox: {x: 0.5, y: 0.1, width: 0.3, height: 0.3}, confidence: 0.9, zIndex: 2, animatable: true, protected: false, motionRole: 'primary', source: 'vision'},
    {id: 'route-1', label: 'Route 1', type: 'route', bbox: {x: 0.2, y: 0.5, width: 0.5, height: 0.1}, confidence: 0.9, zIndex: 3, animatable: true, protected: false, motionRole: 'connector', source: 'vision'},
    {id: 'stats', label: 'Stats', type: 'stat_box', bbox: {x: 0, y: 0.85, width: 1, height: 0.15}, confidence: 1, zIndex: 4, animatable: false, protected: true, motionRole: 'protected', source: 'vision'},
  ],
  protectedRegions: [],
};

const planFor = (prompt: string) => createMotionPlan(new DeterministicMotionPlanner(), {
  prompt,
  durationSeconds: 8,
  fps: 30,
  canvas: {width: 2560, height: 1440},
  sceneAnalysis: scene,
  allowedMotionTypes: [...SUPPORTED_MOTION_TYPES],
});

test('prompt assemble gera montagem sequencial com stagger validada pelo engine', async () => {
  const plan = await planFor('Assemble the map plates, then draw the routes and lock them');
  const types = plan.events.map((event) => event.type);
  assert.ok(types.includes('assemble'));
  assert.ok(types.includes('draw_path'));
  assert.ok(!types.includes('drop'));
  const assemble = plan.events.filter((event) => event.type === 'assemble');
  assert.equal(assemble.length, 2);
  assert.ok(assemble[1].start > assemble[0].start, 'stagger: entradas sequenciais');
  assert.ok(plan.events.every((event) => event.persist === true));
  assert.ok(plan.events.every((event) => event.targetId !== 'stats'), 'protected nunca é alvo');
});

test('prompt reveal/highlight gera mask_reveal e highlight', async () => {
  const plan = await planFor('Reveal the regions from left to right and highlight the capital');
  const types = plan.events.map((event) => event.type);
  assert.ok(types.includes('mask_reveal') || types.includes('wipe_reveal'));
  assert.ok(types.includes('highlight') || types.includes('circle_emphasis'));
});

test('prompt sem verbo mantém o comportamento legado (drop com stagger)', async () => {
  const plan = await planFor('Bring the scene to life');
  assert.ok(plan.events.length >= 2);
  assert.ok(plan.events.every((event) => event.type === 'drop'));
});
