import assert from 'node:assert/strict';
import test from 'node:test';
import type {SceneGraph} from '@editorial-motion/scene-schema';
import {scoreStrategies, STRATEGY_NAMES} from './index';

const element = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  visualType: 'object',
  semanticRole: 'secondary',
  bbox: {x: 0.1, y: 0.1, width: 0.2, height: 0.2},
  confidence: 0.9,
  saliency: 0.6,
  layerability: 0.9,
  movable: true,
  preserveShape: false,
  zIndex: 1,
  ...overrides,
});

const graph = (
  classifications: Array<{type: string; confidence: number}>,
  elements: unknown[],
  extra: Record<string, unknown> = {},
): SceneGraph => ({
  version: '2',
  sceneId: 's',
  canvas: {width: 2560, height: 1440},
  classifications: classifications as never,
  elements: elements as never,
  relationships: [],
  motionGroups: [],
  analysis: {primarySubjectIds: [], visualCenter: {x: 0.5, y: 0.5}, hasDepth: false, hasEmbeddedText: false, hasGraphicConnections: false, complexity: 0.5},
  ...extra,
});

const collageGraph = (): SceneGraph => graph(
  [{type: 'editorial-collage', confidence: 0.84}],
  [
    element('a', {semanticRole: 'primary'}),
    element('b'),
    element('c'),
    element('d'),
  ],
);

test('cena com 4+ layers e collage no topo seleciona disassemble-reassemble (§22)', () => {
  const selection = scoreStrategies(collageGraph());
  assert.equal(selection.selected, 'disassemble-reassemble');
  const best = selection.candidateStrategies[0];
  assert.equal(best.name, 'disassemble-reassemble');
  assert.ok(best.score >= 0.35);
  const collage = selection.candidateStrategies.find((c) => c.name === 'editorial-collage');
  assert.ok(collage && collage.score > 0.3);
});

test('conectores + nós + classificação diagram selecionam network-flow/diagram-build', () => {
  const diagram = graph(
    [{type: 'diagram', confidence: 0.9}],
    [
      element('n1', {visualType: 'node'}),
      element('n2', {visualType: 'node'}),
      element('n3', {visualType: 'node'}),
      element('e1', {visualType: 'connector', layerability: 0.5}),
      element('e2', {visualType: 'connector', layerability: 0.5}),
    ],
  );
  const selection = scoreStrategies(diagram);
  assert.ok(['network-flow', 'diagram-build'].includes(selection.selected), selection.selected);
  assert.ok(selection.candidateStrategies.find((c) => c.name === 'network-flow')!.score > 0.4);
});

test('screenshot com regiões seleciona screenshot-focus; foto com 1-2 layers seleciona parallax/subject-reveal', () => {
  const shot = graph(
    [{type: 'screenshot', confidence: 0.95}],
    [element('panel', {layerability: 0.5}), element('panel-2', {layerability: 0.5})],
  );
  assert.equal(scoreStrategies(shot).selected, 'screenshot-focus');

  const photo = graph(
    [{type: 'photo', confidence: 0.9}],
    [element('subject', {semanticRole: 'primary'})],
  );
  assert.ok(['layered-parallax', 'subject-reveal'].includes(scoreStrategies(photo).selected));
});

test('sem capacidades suficientes cai no safe-fallback (§58)', () => {
  const empty = graph(
    [{type: 'mixed', confidence: 0.5}],
    [element('grain', {layerability: 0.05, movable: false})],
  );
  const selection = scoreStrategies(empty);
  assert.equal(selection.selected, 'safe-fallback');
  const fallback = selection.candidateStrategies.find((c) => c.name === 'safe-fallback');
  assert.equal(fallback?.score, 0.3, 'fallback nunca zera');
});

test('intent do prompt modula scores (§45)', () => {
  const base = scoreStrategies(collageGraph());
  const boosted = scoreStrategies(collageGraph(), {preferredMotion: ['restrained']});
  const parallaxBase = base.candidateStrategies.find((c) => c.name === 'layered-parallax')!.score;
  const parallaxBoosted = boosted.candidateStrategies.find((c) => c.name === 'layered-parallax')!.score;
  assert.ok(parallaxBoosted > parallaxBase, 'tag restrained boosta estratégias discretas');
});

test('todas as estratégias do catálogo §20 aparecem nos candidatos', () => {
  const selection = scoreStrategies(collageGraph());
  assert.deepEqual(new Set(selection.candidateStrategies.map((c) => c.name)), new Set(STRATEGY_NAMES));
  const sorted = [...selection.candidateStrategies].sort((a, b) => b.score - a.score);
  assert.deepEqual(selection.candidateStrategies, sorted, 'candidatos ordenados por score');
});
