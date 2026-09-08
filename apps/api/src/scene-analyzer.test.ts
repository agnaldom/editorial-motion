import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeScene, DevelopmentSemanticProvider, SceneAnalysisError} from './scene-analyzer';

const validAnalysis = {
  version: '1' as const,
  sceneId: 'scene01',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType: 'editorial-collage' as const,
  elements: [],
  protectedRegions: [],
};

test('validates provider output through the canonical schema', async () => {
  const provider = {analyze: async () => validAnalysis};
  const result = await analyzeScene(provider, Buffer.from('image'), 'Static camera');
  assert.equal(result.version, '1');
});

test('rejects malformed provider output', async () => {
  const provider = {analyze: async () => ({version: '1', elements: []})};
  await assert.rejects(() => analyzeScene(provider, Buffer.from('image'), 'Move the map'), SceneAnalysisError);
});

test('does not silently invent analysis without a provider', async () => {
  await assert.rejects(() => analyzeScene(new DevelopmentSemanticProvider(), Buffer.from('image'), 'Move'), /provider is configured/);
});

test('rejects empty image and prompt before provider invocation', async () => {
  const provider = {analyze: async () => validAnalysis};
  await assert.rejects(() => analyzeScene(provider, Buffer.alloc(0), 'Move'), /Image is required/);
  await assert.rejects(() => analyzeScene(provider, Buffer.from('image'), '  '), /prompt is required/);
});
