import assert from 'node:assert/strict';
import test from 'node:test';
import type {SceneGraph} from './graph';
import {applyLayerabilityDecisions, classifyLayerability, layerabilityThresholds} from './layerability';

const graphWith = (layerability: number, movable = true): SceneGraph => ({
  version: '2',
  sceneId: 's',
  canvas: {width: 2560, height: 1440},
  classifications: [{type: 'photo', confidence: 1}],
  elements: [{
    id: 'el', visualType: 'object', semanticRole: 'primary',
    bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.3},
    confidence: 0.9, saliency: 0.8, layerability, movable, preserveShape: false, zIndex: 1,
  }],
  relationships: [],
  motionGroups: [],
  analysis: {primarySubjectIds: ['el'], visualCenter: {x: 0.25, y: 0.25}, hasDepth: false, hasEmbeddedText: false, hasGraphicConnections: false, complexity: 0.5},
});

test('classifyLayerability usa os limiares do §13 (0.72 layer, 0.45 region)', () => {
  const t = layerabilityThresholds();
  assert.equal(t.layerMin, 0.72);
  assert.equal(t.regionMin, 0.45);
  assert.equal(classifyLayerability(0.95), 'layer');
  assert.equal(classifyLayerability(0.72), 'layer');
  assert.equal(classifyLayerability(0.5), 'region');
  assert.equal(classifyLayerability(0.44), 'attached');
  assert.equal(classifyLayerability(0), 'attached');
});

test('limiares são configuráveis por env', (t) => {
  const original = process.env.LAYERABILITY_LAYER_MIN;
  process.env.LAYERABILITY_LAYER_MIN = '0.8';
  t.after(() => {
    if (original === undefined) delete process.env.LAYERABILITY_LAYER_MIN;
    else process.env.LAYERABILITY_LAYER_MIN = original;
  });
  assert.equal(layerabilityThresholds().layerMin, 0.8);
  assert.equal(classifyLayerability(0.75), 'region', 'acima do default 0.72 mas abaixo do custom 0.8');
});

test('applyLayerabilityDecisions trava movimento de elemento attached', () => {
  const attached = applyLayerabilityDecisions(graphWith(0.2));
  assert.equal(attached.elements[0].movable, false);

  const layer = applyLayerabilityDecisions(graphWith(0.9));
  assert.equal(layer.elements[0].movable, true);

  const alreadyStatic = applyLayerabilityDecisions(graphWith(0.2, false));
  assert.equal(alreadyStatic.elements[0].movable, false);
});
