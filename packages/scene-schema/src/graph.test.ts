import assert from 'node:assert/strict';
import test from 'node:test';
import type {SceneAnalysis} from './index';
import {
  sceneAnalysisToSceneGraph,
  sceneGraphSchema,
  validateSceneGraph,
  type SceneGraph,
} from './graph';

const element = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  visualType: 'object',
  semanticRole: 'secondary',
  bbox: {x: 0.1, y: 0.1, width: 0.2, height: 0.2},
  confidence: 0.9,
  movable: true,
  zIndex: 1,
  ...overrides,
});

const baseGraph = (elements: unknown[], extra: Record<string, unknown> = {}): SceneGraph =>
  sceneGraphSchema.parse({
    version: '2',
    sceneId: 'scene-01',
    canvas: {width: 2560, height: 1440},
    classifications: [{type: 'editorial-collage', confidence: 0.84}],
    elements,
    analysis: {
      visualCenter: {x: 0.5, y: 0.5},
      hasDepth: false,
      hasEmbeddedText: false,
      hasGraphicConnections: false,
      complexity: 0.5,
    },
    ...extra,
  });

test('sceneGraphSchema aceita o grafo canônico do §15', () => {
  const graph = baseGraph([
    element('bg-01', {visualType: 'background', semanticRole: 'background'}),
    element('element-01', {semanticRole: 'primary', layerability: 0.91}),
    element('element-05', {visualType: 'node'}),
  ], {background: 'bg-01'});
  assert.equal(graph.version, '2');
  assert.equal(validateSceneGraph(graph).valid, true);
});

test('validateSceneGraph rejeita ids duplicados, parent/group/relationship quebrados (§60)', () => {
  const duplicated = baseGraph([element('a'), element('a')]);
  assert.equal(validateSceneGraph(duplicated).valid, false);

  const badParent = baseGraph([element('a', {parentId: 'missing'})]);
  assert.match(validateSceneGraph(badParent).errors.join(';'), /Unknown parentId/);

  const badGroup = baseGraph([element('a', {groupId: 'nope'})]);
  assert.match(validateSceneGraph(badGroup).errors.join(';'), /Unknown groupId/);

  const badRelationship = baseGraph([element('a')], {relationships: [{source: 'a', target: 'b', type: 'connected'}]});
  assert.match(validateSceneGraph(badRelationship).errors.join(';'), /target not found/);

  const selfRel = baseGraph([element('a')], {relationships: [{source: 'a', target: 'a', type: 'connected'}]});
  assert.match(validateSceneGraph(selfRel).errors.join(';'), /Self relationship/);

  const badGroupMember = baseGraph([element('a')], {motionGroups: [{id: 'g1', members: ['ghost'], anchor: 'center'}]});
  assert.match(validateSceneGraph(badGroupMember).errors.join(';'), /unknown member/);

  const badPrimary = baseGraph([element('a')], {analysis: {
    primarySubjectIds: ['ghost'],
    visualCenter: {x: 0.5, y: 0.5},
    hasDepth: false,
    hasEmbeddedText: false,
    hasGraphicConnections: false,
    complexity: 0.5,
  }});
  assert.match(validateSceneGraph(badPrimary).errors.join(';'), /Primary subject not found/);
});

test('validateSceneGraph aceita grafo consistente com grupos e relacionamentos', () => {
  const graph = baseGraph([
    element('person', {visualType: 'subject', semanticRole: 'primary', groupId: 'mg-1'}),
    element('label', {visualType: 'text', semanticRole: 'annotation', parentId: 'person', textStrategy: 'keep_with_parent'}),
    element('bg', {visualType: 'background', semanticRole: 'background'}),
  ], {
    background: 'bg',
    motionGroups: [{id: 'mg-1', members: ['person', 'label'], anchor: 'center'}],
    relationships: [{source: 'person', target: 'bg', type: 'attached'}],
  });
  const result = validateSceneGraph(graph);
  assert.equal(result.valid, true, result.errors.join(';'));
});

const sceneV1: SceneAnalysis = {
  version: '1',
  sceneId: 'scene01',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'map',
  elements: [
    {id: 'plate-a', label: 'A', type: 'map_region', bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.3}, confidence: 0.9, zIndex: 1, animatable: true, protected: false, motionRole: 'primary', source: 'vision'},
    {id: 'route-1', label: 'R', type: 'route', bbox: {x: 0.2, y: 0.5, width: 0.5, height: 0.1}, confidence: 0.9, zIndex: 2, animatable: true, protected: false, motionRole: 'connector', source: 'vision'},
    {id: 'stats', label: 'S', type: 'stat_box', bbox: {x: 0.7, y: 0.1, width: 0.25, height: 0.15}, confidence: 1, zIndex: 3, animatable: false, protected: true, motionRole: 'protected', source: 'vision'},
  ],
  protectedRegions: [{id: 'stats-region', label: 'Stats', bbox: {x: 0.7, y: 0.7, width: 0.3, height: 0.2}, reason: 'reserved'}],
};

test('sceneAnalysisToSceneGraph migra v1 → v2 com papéis, proteção e análise derivada', () => {
  const graph = sceneAnalysisToSceneGraph(sceneV1);
  assert.equal(graph.version, '2');
  assert.deepEqual(graph.classifications, [{type: 'map', confidence: 1}]);

  const plate = graph.elements.find((item) => item.id === 'plate-a')!;
  assert.equal(plate.visualType, 'region');
  assert.equal(plate.semanticRole, 'primary');
  assert.equal(plate.movable, true);
  assert.equal(plate.preserveShape, false);

  const route = graph.elements.find((item) => item.id === 'route-1')!;
  assert.equal(route.visualType, 'connector');
  assert.equal(route.semanticRole, 'connector');

  const stats = graph.elements.find((item) => item.id === 'stats')!;
  assert.equal(stats.visualType, 'text');
  assert.equal(stats.preserveShape, true);
  assert.equal(stats.movable, false);
  assert.equal(stats.textStrategy, 'keep_static');

  const region = graph.elements.find((item) => item.id === 'stats-region')!;
  assert.equal(region.semanticRole, 'annotation');
  assert.equal(region.textStrategy, 'keep_static');

  assert.deepEqual(graph.analysis.primarySubjectIds, ['plate-a']);
  assert.equal(graph.analysis.hasEmbeddedText, true);
  assert.equal(graph.analysis.hasGraphicConnections, true);
  assert.equal(graph.analysis.visualCenter.x, 0.25);
  assert.equal(validateSceneGraph(graph).valid, true);
});

test('sceneAnalysisToSceneGraph honra element.background como background do grafo', () => {
  const withBg: SceneAnalysis = {
    ...sceneV1,
    elements: [
      ...sceneV1.elements,
      {id: 'bg', label: 'BG', type: 'background', bbox: {x: 0, y: 0, width: 1, height: 1}, confidence: 1, zIndex: 0, animatable: false, protected: false, motionRole: 'static', source: 'vision'},
    ],
  };
  const graph = sceneAnalysisToSceneGraph(withBg);
  assert.equal(graph.background, 'bg');
  assert.equal(validateSceneGraph(graph).valid, true);
});
