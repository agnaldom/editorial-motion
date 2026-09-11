import assert from 'node:assert/strict';
import test from 'node:test';
import {VisionServiceSceneAnalyzer} from './scene-heuristics';
import {solidMaskPng} from './png';

const heuristicAnalysis = {
  version: '1',
  sceneId: 'scene01',
  source: {width: 16, height: 12, aspectRatio: 16 / 12},
  compositionType: 'editorial-collage',
  elements: [
    {id: 'region-1', label: 'Plate A', type: 'map_region', bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.4}, confidence: 0.8, zIndex: 1, animatable: true, protected: false, motionRole: 'primary', source: 'detector'},
    {id: 'region-2', label: 'Stats band', type: 'stat_box', bbox: {x: 0, y: 0.85, width: 1, height: 0.15}, confidence: 0.7, zIndex: 2, animatable: false, protected: true, motionRole: 'protected', source: 'detector'},
  ],
  protectedRegions: [{id: 'region-2', label: 'Stats band', bbox: {x: 0, y: 0.85, width: 1, height: 0.15}, reason: 'heuristic numeric/label zone'}],
};

const stubFetch = (t: test.TestContext, handler: () => Response | Promise<Response>): void => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => handler();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
};

test('delega ao vision-service e devolve a SceneAnalysis heurística', async (t) => {
  stubFetch(t, () => new Response(JSON.stringify(heuristicAnalysis), {status: 200}));
  const analyzer = new VisionServiceSceneAnalyzer('http://vision:9000');
  const result = await analyzer.analyze({image: solidMaskPng(16, 12), prompt: 'Assemble the plates'}) as typeof heuristicAnalysis;
  assert.equal(result.elements.length, 2);
  assert.equal(result.elements[1].protected, true);
});

test('serviço fora do ar degrada para o double de elemento único', async (t) => {
  stubFetch(t, () => {
    throw new Error('connection refused');
  });
  const analyzer = new VisionServiceSceneAnalyzer('http://vision:9000');
  const result = await analyzer.analyze({image: solidMaskPng(16, 12), prompt: 'Animate'}) as {elements: Array<{id: string}>};
  assert.deepEqual(result.elements.map((element) => element.id), ['composition']);
});

test('resposta não-ok também degrada para o fallback', async (t) => {
  stubFetch(t, () => new Response('boom', {status: 502}));
  const analyzer = new VisionServiceSceneAnalyzer('http://vision:9000');
  const result = await analyzer.analyze({image: solidMaskPng(16, 12), prompt: 'Animate'}) as {elements: Array<{id: string}>};
  assert.deepEqual(result.elements.map((element) => element.id), ['composition']);
});

test('sem VISION_SERVICE_URL nem chama fetch e usa o double', async (t) => {
  let called = false;
  stubFetch(t, () => {
    called = true;
    return new Response('{}', {status: 200});
  });
  const analyzer = new VisionServiceSceneAnalyzer(undefined);
  const result = await analyzer.analyze({image: solidMaskPng(16, 12), prompt: 'Animate'}) as {elements: Array<{id: string}>};
  assert.equal(called, false);
  assert.deepEqual(result.elements.map((element) => element.id), ['composition']);
});
