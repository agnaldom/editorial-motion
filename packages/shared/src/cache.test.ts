import assert from 'node:assert/strict';
import test from 'node:test';
import {analysisCacheKey, MemoryCache, sourceHash} from './cache';

const versions = {visionModel: 'vision-v1', segmentationModel: 'sam2-v1', inpaintingModel: 'lama-v1'};

test('creates a stable SHA-256 source hash', () => {
  assert.equal(sourceHash(new TextEncoder().encode('image')).length, 64);
  assert.equal(sourceHash(new TextEncoder().encode('image')), sourceHash(new TextEncoder().encode('image')));
});

test('changes the cache key when a provider version changes', () => {
  const image = new TextEncoder().encode('image');
  assert.notEqual(analysisCacheKey(image, versions), analysisCacheKey(image, {...versions, visionModel: 'vision-v2'}));
});

test('stores and retrieves typed cached values', () => {
  const cache = new MemoryCache<{sceneId: string}>();
  cache.set('key', {sceneId: 'scene01'});
  assert.deepEqual(cache.get('key'), {sceneId: 'scene01'});
  assert.equal(cache.has('missing'), false);
});
