import assert from 'node:assert/strict';
import test from 'node:test';
import {createMotionPlan, DevelopmentMotionPlanner, MotionPlanError} from './motion-planner';

const scene = {
  version: '1' as const, sceneId: 'scene01', source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'map' as const, elements: [{
    id: 'map', label: 'Map', type: 'map_region' as const, bbox: {x: 0, y: 0, width: 1, height: 1}, confidence: 1,
    zIndex: 1, animatable: true, protected: false, motionRole: 'primary' as const, source: 'vision' as const,
  }], protectedRegions: [],
};
const input = {prompt: 'Fade in the map', durationSeconds: 8, fps: 30, sceneAnalysis: scene, allowedMotionTypes: ['fade_in']};
const validPlan = {
  version: '1' as const, sceneId: 'scene01', stylePreset: 'editorial-documentary' as const, durationSeconds: 8,
  fps: 30, canvas: {width: 2560, height: 1440}, camera: {type: 'static' as const}, events: [], finalHold: {start: 6, duration: 2},
};

test('accepts a structured valid plan', async () => {
  const result = await createMotionPlan({plan: async () => validPlan}, input);
  assert.equal(result.stylePreset, 'editorial-documentary');
});

test('repairs an invalid plan before failing', async () => {
  let repairs = 0;
  const result = await createMotionPlan({
    plan: async () => ({bad: true}),
    repair: async () => { repairs += 1; return validPlan; },
  }, input);
  assert.equal(repairs, 1);
  assert.equal(result.sceneId, 'scene01');
});

test('rejects unknown target IDs through the deterministic validator', async () => {
  await assert.rejects(() => createMotionPlan({plan: async () => ({...validPlan, events: [{id: 'bad', type: 'fade_in', targetId: 'missing', start: 0, duration: 1}]})}, input), MotionPlanError);
});

test('fails explicitly when no provider is configured', async () => {
  await assert.rejects(() => createMotionPlan(new DevelopmentMotionPlanner(), input), /provider is configured/);
});
