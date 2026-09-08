import assert from 'node:assert/strict';
import test from 'node:test';
import {motionPlanSchema} from './index';

const validPlan = {
  version: '1' as const,
  sceneId: 'scene01',
  stylePreset: 'editorial-documentary' as const,
  durationSeconds: 8,
  fps: 30,
  canvas: {width: 2560, height: 1440},
  camera: {type: 'static' as const},
  events: [],
  finalHold: {start: 6, duration: 2},
};

test('accepts a valid motion plan', () => {
  assert.equal(motionPlanSchema.parse(validPlan).fps, 30);
});

test('rejects plans shorter than eight seconds', () => {
  assert.throws(() => motionPlanSchema.parse({...validPlan, durationSeconds: 7}));
});

test('rejects forbidden motion types at schema level', () => {
  assert.throws(() => motionPlanSchema.parse({...validPlan, events: [{id: 'spin', type: 'spin', targetId: 'map', start: 0, duration: 1}]}));
});
