import assert from 'node:assert/strict';
import test from 'node:test';
import {sceneAnalysisSchema} from './index';

const validScene = {
  version: '1' as const,
  sceneId: 'scene01',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'map' as const,
  elements: [],
  protectedRegions: [],
};

test('accepts a valid scene analysis', () => {
  assert.equal(sceneAnalysisSchema.parse(validScene).sceneId, 'scene01');
});

test('rejects coordinates outside the normalized range', () => {
  assert.throws(() => sceneAnalysisSchema.parse({
    ...validScene,
    elements: [{
      id: 'map', label: 'Map', type: 'map_region', bbox: {x: 1.1, y: 0, width: 0.5, height: 0.5},
      confidence: 0.9, zIndex: 1, animatable: true, protected: false,
      motionRole: 'primary', source: 'vision',
    }],
  }));
});

test('rejects unknown fields', () => {
  assert.throws(() => sceneAnalysisSchema.parse({...validScene, unexpected: true}));
});
