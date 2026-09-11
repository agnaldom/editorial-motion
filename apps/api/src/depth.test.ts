import assert from 'node:assert/strict';
import test from 'node:test';
import {motionPlanSchema} from '@editorial-motion/motion-schema';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import {applyDepthMotion, DEPTH_FOREGROUND_ID, depthForegroundElement, fetchForegroundSaliency} from './depth';
import {solidMaskPng} from './png';

const stubFetch = (t: test.TestContext, handler: (url: string) => Response): void => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => handler(String(input));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
};

test('fetchForegroundSaliency devolve máscara e metadados', async (t) => {
  stubFetch(t, (url) => {
    assert.match(url, /\/v1\/saliency\/foreground$/);
    return new Response(solidMaskPng(4, 4), {
      status: 200,
      headers: {'x-saliency-metadata': JSON.stringify({bbox: {x: 0.2, y: 0.2, width: 0.4, height: 0.4}, coverage: 0.3})},
    });
  });
  const result = await fetchForegroundSaliency(solidMaskPng(4, 4), 'http://vision:9000');
  assert.equal(result?.coverage, 0.3);
  assert.equal(result?.bbox.width, 0.4);
  assert.ok(result?.mask.length);
});

test('fetchForegroundSaliency degrada para null em falha', async (t) => {
  stubFetch(t, () => new Response('boom', {status: 502}));
  assert.equal(await fetchForegroundSaliency(solidMaskPng(4, 4), 'http://vision:9000'), null);
  assert.equal(await fetchForegroundSaliency(solidMaskPng(4, 4), undefined), null);
});

const scene: SceneAnalysis = {
  version: '1',
  sceneId: 'scene01',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'photo',
  elements: [depthForegroundElement({x: 0.3, y: 0.25, width: 0.4, height: 0.5})],
  protectedRegions: [],
};

const basePlan = motionPlanSchema.parse({
  version: '1',
  sceneId: 'scene01',
  stylePreset: 'editorial-documentary',
  durationSeconds: 8,
  fps: 30,
  canvas: {width: 2560, height: 1440},
  camera: {type: 'static'},
  events: [{id: 'evt-legacy', type: 'drop', targetId: DEPTH_FOREGROUND_ID, start: 0.4, duration: 0.8, persist: true}],
  finalHold: {start: 3, duration: 5},
});

test('applyDepthMotion produz parallax dentro dos limites do engine', () => {
  const plan = applyDepthMotion(basePlan);
  const validation = validateMotionPlan(plan, scene);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(plan.camera.type, 'subtle_pan');
  const pan = plan.camera.params!;
  assert.equal(pan.xTo! - pan.xFrom!, 0.04, 'pan mínimo de 4% (limite 5%)');
  const shift = plan.events.find((event) => event.type === 'shift')!;
  assert.equal(shift.targetId, DEPTH_FOREGROUND_ID);
  assert.equal((shift.params as {dxRatio: number}).dxRatio, -0.03, 'foreground em direção oposta ao pan');
  assert.ok(plan.events.some((event) => event.type === 'fade_in'), 'entrada com fade, não seco');
  assert.ok(plan.events.every((event) => event.start + event.duration <= plan.durationSeconds));
});
