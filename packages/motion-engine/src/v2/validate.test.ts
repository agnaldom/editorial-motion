import assert from 'node:assert/strict';
import test from 'node:test';
import type {MotionPlanV2} from '@editorial-motion/motion-schema';
import {motionPlanV2Schema} from '@editorial-motion/motion-schema';
import type {SceneGraph} from '@editorial-motion/scene-schema';
import {validateMotionPlanV2, validatorModeFor} from './validate';

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

const graph = (elements: unknown[]): SceneGraph => ({
  version: '2',
  sceneId: 's',
  canvas: {width: 2560, height: 1440},
  classifications: [{type: 'editorial-collage', confidence: 0.84}],
  elements: elements as never,
  relationships: [],
  motionGroups: [],
  analysis: {primarySubjectIds: [], visualCenter: {x: 0.5, y: 0.5}, hasDepth: false, hasEmbeddedText: false, hasGraphicConnections: false, complexity: 0.5},
});

const plan = (tracks: unknown[], extra: Record<string, unknown> = {}): MotionPlanV2 =>
  motionPlanV2Schema.parse({
    version: '2',
    meta: {durationFrames: 240, fps: 30, width: 2560, height: 1440, preset: 'editorial-documentary'},
    strategy: {name: 'disassemble-reassemble', qualityLevel: 3},
    tracks,
    ...extra,
  });

const moving = (target: string, startFrame = 30, endFrame = 120) => ({
  target,
  animations: [{type: 'translate', startFrame, endFrame, from: {x: 0, y: 0}, to: {x: 0.05, y: 0}}],
});

test('plano com 2+ elementos independentes em modo semantic passa', () => {
  const result = validateMotionPlanV2(
    plan([moving('a'), moving('b')]),
    graph([element('a'), element('b')]),
  );
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.metrics.independentAnimatedElements, 2);
  assert.ok(result.metrics.expectedFrameVariance > 0.3);
});

test('source-only: animar só o background falha em modo semantic (§34)', () => {
  const result = validateMotionPlanV2(
    plan([moving('bg'), moving('bg2', 60, 150)]),
    graph([
      element('bg', {visualType: 'background', semanticRole: 'background'}),
      element('bg2', {visualType: 'background', semanticRole: 'background'}),
    ]),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === 'MOTION_PLAN_INVALID' && /source\/background/.test(issue.message)));
});

test('semantic exige >= 2 elementos independentes (§34)', () => {
  const result = validateMotionPlanV2(
    plan([moving('a')]),
    graph([element('a'), element('b')]),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => />= 2 independent/.test(issue.message)));
  assert.equal(result.metrics.independentAnimatedElements, 1);
});

test('modo fallback não exige 2 elementos nem falha source-only', () => {
  const fallbackPlan = motionPlanV2Schema.parse({
    version: '2',
    meta: {durationFrames: 240, fps: 30, width: 2560, height: 1440, preset: 'editorial-documentary'},
    strategy: {name: 'safe-fallback', qualityLevel: 1},
    tracks: [moving('bg')],
  });
  const result = validateMotionPlanV2(fallbackPlan, graph([element('bg', {visualType: 'background'})]));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.warnings.some((issue) => /Whole-image-only/.test(issue.message)));
});

test('MOTION_PLAN_TOO_STATIC: plano sem mudança visual real é rejeitado (§35)', () => {
  const staticPlan = plan([
    {target: 'a', animations: [{type: 'hold', startFrame: 0, endFrame: 240}]},
    {target: 'b', animations: [{type: 'hold', startFrame: 0, endFrame: 240}]},
  ]);
  const result = validateMotionPlanV2(staticPlan, graph([element('a'), element('b')]));
  assert.equal(result.valid, false);
  const tooStatic = result.errors.find((issue) => issue.code === 'MOTION_PLAN_TOO_STATIC');
  assert.ok(tooStatic, JSON.stringify(result.errors));
  assert.equal(result.metrics.expectedFrameVariance, 0);
});

test('animação que excede a timeline é erro (§34)', () => {
  const result = validateMotionPlanV2(
    plan([moving('a', 200, 300)]),
    graph([element('a'), element('b')]),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => /past duration/.test(issue.message)));
});

test('target desconhecido é erro', () => {
  const result = validateMotionPlanV2(plan([moving('ghost'), moving('a')]), graph([element('a'), element('b')]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => /Unknown target/.test(issue.message)));
});

test('rotação acima de 3° vira warning de preset (§49)', () => {
  const result = validateMotionPlanV2(
    plan([
      moving('a'),
      {target: 'b', animations: [{type: 'rotate', startFrame: 30, endFrame: 90, from: 0, to: 8}]},
    ]),
    graph([element('a'), element('b')]),
  );
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((issue) => /3° editorial preset/.test(issue.message)));
});

test('validatorModeFor deriva do qualityLevel', () => {
  assert.equal(validatorModeFor(plan([moving('a'), moving('b')])), 'semantic');
  const region = motionPlanV2Schema.parse({
    version: '2',
    meta: {durationFrames: 240, fps: 30, width: 2560, height: 1440, preset: 'editorial-documentary'},
    strategy: {name: 'focus-region', qualityLevel: 2},
    tracks: [moving('a')],
  });
  assert.equal(validatorModeFor(region), 'region');
});
