import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import test from 'node:test';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import {LocalStorageDriver} from '../../apps/api/src/storage';
import {MemoryJobRepository} from '../../apps/api/src/repository';
import {createRenderJob} from '../../apps/api/src/jobs';
import {processJob, probeVideo, RemotionCliRenderService} from '../../apps/api/src/stages';
import type {SemanticVisionProvider} from '../../apps/api/src/scene-analyzer';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fixtureImage = readFileSync(path.join(fixturesDir, 'headline-text-composition.png'));

// Ground truth for headline-text-composition.png (see fixtures/generate.mjs):
// every drawn shape becomes an analysis element with its exact normalized bbox.
const fixtureAnalysis: SceneAnalysis = {
  version: '1',
  sceneId: 'headline-text-composition',
  source: {width: 1280, height: 720, aspectRatio: 16 / 9},
  compositionType: 'editorial-collage',
  elements: [
    {id: 'headline', label: 'Headline', type: 'text', bbox: {x: 0.109, y: 0.167, width: 0.781, height: 0.125}, confidence: 1, zIndex: 1, animatable: false, protected: true, motionRole: 'protected', source: 'vision'},
    {id: 'subtitle', label: 'Subtitle', type: 'text', bbox: {x: 0.188, y: 0.333, width: 0.625, height: 0.042}, confidence: 1, zIndex: 1, animatable: false, protected: true, motionRole: 'protected', source: 'vision'},
    {id: 'red-disc', label: 'Red disc', type: 'icon', bbox: {x: 0.109, y: 0.528, width: 0.125, height: 0.222}, confidence: 0.95, zIndex: 2, animatable: true, protected: false, motionRole: 'primary', source: 'vision'},
    {id: 'blue-block', label: 'Blue block', type: 'photo', bbox: {x: 0.328, y: 0.556, width: 0.172, height: 0.194}, confidence: 0.95, zIndex: 2, animatable: true, protected: false, motionRole: 'secondary', source: 'vision'},
    {id: 'green-triangle', label: 'Green triangle', type: 'decorative', bbox: {x: 0.562, y: 0.556, width: 0.219, height: 0.194}, confidence: 0.95, zIndex: 2, animatable: true, protected: false, motionRole: 'secondary', source: 'vision'},
  ],
  protectedRegions: [
    {id: 'headline', label: 'Headline', bbox: {x: 0.109, y: 0.167, width: 0.781, height: 0.125}, reason: 'typography'},
    {id: 'subtitle', label: 'Subtitle', bbox: {x: 0.188, y: 0.333, width: 0.625, height: 0.042}, reason: 'typography'},
  ],
};

class FixtureAnalyzer implements SemanticVisionProvider {
  async analyze(): Promise<unknown> {
    return fixtureAnalysis;
  }
}

test('fixture runs through every pipeline stage into a valid short MP4', {timeout: 480_000}, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-integration-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const job = createRenderJob('job_fixture', {
    prompt: 'Reveal the visual elements around the headline without modifying the existing typography.',
    durationSeconds: 8,
    width: 640,
    height: 360,
    fps: 30,
    inputAssetKey: 'jobs/job_fixture/input/original.png',
    outputFileName: 'fixture.mp4',
  });
  await storage.put(job.inputAssetKey!, fixtureImage);
  await repository.save(job);

  await processJob('job_fixture', {repository, storage, renderService: new RemotionCliRenderService(), analyzer: new FixtureAnalyzer()});

  const finished = await repository.get('job_fixture');
  assert.equal(finished?.status, 'completed');
  assert.equal(finished?.progress, 100);

  const analysis = JSON.parse((await storage.get('jobs/job_fixture/analysis/scene-analysis.json')).toString('utf8')) as SceneAnalysis;
  const targetIds = analysis.elements.filter((element) => element.animatable).map((element) => element.id).sort();
  assert.deepEqual(targetIds, ['blue-block', 'green-triangle', 'red-disc']);

  const renderInput = JSON.parse((await storage.get('jobs/job_fixture/render-input.json')).toString('utf8')) as {
    layers: Array<{elementId: string}>;
  };
  assert.deepEqual(renderInput.layers.map((layer) => layer.elementId).sort(), targetIds);

  const plan = JSON.parse((await storage.get('jobs/job_fixture/motion/motion-plan.json')).toString('utf8')) as {
    events: Array<{targetId: string}>;
  };
  for (const event of plan.events) {
    assert.ok(targetIds.includes(event.targetId), `plan references unknown target: ${event.targetId}`);
  }

  const output = await storage.get('jobs/job_fixture/output/fixture.mp4');
  assert.ok(output.length > 10_000, `MP4 is suspiciously small: ${output.length} bytes`);
  assert.equal(output.subarray(4, 8).toString('ascii'), 'ftyp', 'output is not an MP4 container');

  const probe = await probeVideo(storage.resolvePath('jobs/job_fixture/output/fixture.mp4'));
  if (probe) {
    assert.equal(probe.width, 640);
    assert.equal(probe.height, 360);
    assert.ok(Math.abs(probe.durationSeconds - 8) <= 0.5);
  }
});
