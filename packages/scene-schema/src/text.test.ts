import assert from 'node:assert/strict';
import test from 'node:test';
import {sceneGraphSchema, validateSceneGraph, type SceneGraph} from './graph';
import {applyShapePreservation, attachTextElements, buildMotionGroups, enrichSceneGraph} from './text';

const element = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  visualType: 'object',
  semanticRole: 'secondary',
  bbox: {x: 0.1, y: 0.1, width: 0.4, height: 0.4},
  confidence: 0.9,
  saliency: 0.7,
  layerability: 0.9,
  movable: true,
  preserveShape: false,
  zIndex: 1,
  ...overrides,
});

const graph = (elements: unknown[], extra: Record<string, unknown> = {}): SceneGraph =>
  sceneGraphSchema.parse({
    version: '2',
    sceneId: 's',
    canvas: {width: 2560, height: 1440},
    classifications: [{type: 'photo', confidence: 1}],
    elements,
    analysis: {primarySubjectIds: [], visualCenter: {x: 0.5, y: 0.5}, hasDepth: false, hasEmbeddedText: false, hasGraphicConnections: false, complexity: 0.5},
    ...extra,
  });

test('texto dentro do bbox do objeto fica anexado (KEEP_WITH_PARENT, §19)', () => {
  const enriched = attachTextElements(graph([
    element('person', {visualType: 'subject', semanticRole: 'primary'}),
    element('name-tag', {visualType: 'text', bbox: {x: 0.2, y: 0.15, width: 0.15, height: 0.06}}),
  ]));
  const tag = enriched.elements.find((item) => item.id === 'name-tag')!;
  assert.equal(tag.parentId, 'person');
  assert.equal(tag.textStrategy, 'keep_with_parent');
  assert.equal(tag.movable, false);
});

test('texto isolado (faixa de label) fica KEEP_STATIC', () => {
  const enriched = attachTextElements(graph([
    element('plate', {bbox: {x: 0, y: 0, width: 0.5, height: 0.5}}),
    element('footer-band', {visualType: 'text', bbox: {x: 0.1, y: 0.9, width: 0.8, height: 0.08}}),
  ]));
  const band = enriched.elements.find((item) => item.id === 'footer-band')!;
  assert.equal(band.parentId, undefined);
  assert.equal(band.textStrategy, 'keep_static');
});

test('preserveShape default: texto e anotações nunca deformam (§38)', () => {
  const enriched = applyShapePreservation(graph([
    element('obj'),
    element('lbl', {visualType: 'text'}),
    element('note', {semanticRole: 'annotation', movable: false}),
  ]));
  assert.equal(enriched.elements.find((item) => item.id === 'obj')?.preserveShape, false);
  assert.equal(enriched.elements.find((item) => item.id === 'lbl')?.preserveShape, true);
  assert.equal(enriched.elements.find((item) => item.id === 'note')?.preserveShape, true);
});

test('humano = motion group único com anexos (§39)', () => {
  const withGroups = buildMotionGroups(graph([
    element('person', {visualType: 'subject', semanticRole: 'primary'}),
    element('name-tag', {visualType: 'text', parentId: 'person', textStrategy: 'keep_with_parent'}),
  ]));
  assert.equal(withGroups.motionGroups.length, 1);
  assert.deepEqual(withGroups.motionGroups[0].members, ['person', 'name-tag']);
  assert.equal(withGroups.elements.find((item) => item.id === 'name-tag')?.groupId, 'mg-person');
  assert.equal(validateSceneGraph(withGroups).valid, true);
});

test('enrichSceneGraph encadeia anexo + preservação + grupos', () => {
  const enriched = enrichSceneGraph(graph([
    element('person', {visualType: 'subject', semanticRole: 'primary'}),
    element('name-tag', {visualType: 'text', bbox: {x: 0.2, y: 0.15, width: 0.15, height: 0.06}}),
  ]));
  const tag = enriched.elements.find((item) => item.id === 'name-tag')!;
  assert.equal(tag.parentId, 'person');
  assert.equal(tag.preserveShape, true);
  assert.equal(tag.groupId, 'mg-person');
  assert.equal(validateSceneGraph(enriched).valid, true, validateSceneGraph(enriched).errors.join(';'));
});
