import assert from 'node:assert/strict';
import test from 'node:test';
import {OmniRouteMotionPlanner, OmniRouteSceneAnalyzer} from './llm-providers';
import {solidMaskPng} from './png';

const scene = {
  version: '1' as const, sceneId: 'scene01', source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'map' as const, elements: [{
    id: 'china', label: 'China', type: 'map_region' as const, bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.4},
    confidence: 0.9, zIndex: 1, animatable: true, protected: false, motionRole: 'primary' as const, source: 'vision' as const,
  }], protectedRegions: [],
};
const plannerInput = {
  prompt: 'Drop the silhouette into place',
  durationSeconds: 8,
  fps: 30,
  canvas: {width: 2560, height: 1440},
  sceneAnalysis: scene,
  allowedMotionTypes: ['drop'],
};

const stubFetch = (t: test.TestContext, handler: (body: {model: string; messages: Array<{role: string; content: unknown}>}) => string): void => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as {model: string; messages: Array<{role: string; content: unknown}>};
    return new Response(JSON.stringify({choices: [{message: {content: handler(body)}}]}), {status: 200});
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
};

test('planner sends the input package and parses the plan JSON', async (t) => {
  stubFetch(t, (body) => {
    assert.equal(body.model, 'anthropic/claude-sonnet-4');
    const user = body.messages.at(-1)?.content as string;
    assert.match(user, /"prompt":"Drop the silhouette into place"/);
    assert.match(user, /"allowedMotionTypes":\["drop"\]/);
    assert.match(user, /"rules"/);
    return '{"version":"1","sceneId":"scene01","stylePreset":"editorial-documentary","durationSeconds":8,"fps":30,"canvas":{"width":2560,"height":1440},"camera":{"type":"static"},"events":[],"finalHold":{"start":6,"duration":2}}';
  });
  const planner = new OmniRouteMotionPlanner('anthropic/claude-sonnet-4', {baseUrl: 'http://localhost:20128/v1'});
  const plan = await planner.plan(plannerInput) as {camera: {type: string}};
  assert.equal(plan.camera.type, 'static');
});

test('planner repair includes the previous attempt and validation errors', async (t) => {
  stubFetch(t, (body) => {
    const user = body.messages.at(-1)?.content as string;
    assert.match(user, /"previousAttempt":\{"bad":true\}/);
    assert.match(user, /"validationErrors":\["unknown target"\]/);
    return '{"fixed":true}';
  });
  const planner = new OmniRouteMotionPlanner('gemini/gemini-2.5-flash', {baseUrl: 'http://localhost:20128/v1'});
  const repaired = await planner.repair(plannerInput, {bad: true}, ['unknown target']) as {fixed: boolean};
  assert.equal(repaired.fixed, true);
});

test('planner request carries the motion catalog and verb gesture hints', async (t) => {
  stubFetch(t, (body) => {
    const system = body.messages[0].content as string;
    assert.match(system, /wipe_reveal \(params\.direction left\|right\|up\|down\)/);
    assert.match(system, /draw_path\/draw_arrow \(only route\/arrow elements/);
    const user = body.messages.at(-1)?.content as string;
    assert.match(user, /"gestureHints":\["assemble[^"]*"\]/);
    return '{"version":"1"}';
  });
  const planner = new OmniRouteMotionPlanner('anthropic/claude-sonnet-4', {baseUrl: 'http://localhost:20128/v1'});
  await planner.plan({...plannerInput, prompt: 'Assemble the plates'});
});

test('analyzer sends the image as a base64 data URL', async (t) => {
  const image = solidMaskPng(4, 4);
  stubFetch(t, (body) => {
    assert.equal(body.model, 'gemini/gemini-2.5-flash');
    const user = body.messages.at(-1)?.content as Array<{type: string; text?: string; image_url?: {url: string}}>;
    const textPart = user.find((part) => part.type === 'text');
    const imagePart = user.find((part) => part.type === 'image_url');
    assert.match(textPart?.text ?? '', /Motion prompt: Reveal the map/);
    assert.match(textPart?.text ?? '', /classifications \(up to 3 of:/);
    assert.match(imagePart?.image_url?.url ?? '', /^data:image\/png;base64,/);
    return '{"version":"1"}';
  });
  const analyzer = new OmniRouteSceneAnalyzer('gemini/gemini-2.5-flash', {baseUrl: 'http://localhost:20128/v1'});
  const analysis = await analyzer.analyze({image, prompt: 'Reveal the map'});
  assert.deepEqual(analysis, {version: '1'});
});
