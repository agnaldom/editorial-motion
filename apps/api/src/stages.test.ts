import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalStorageDriver} from './storage';
import {buildStageHandlers, FakeRenderService, parseRenderProgress, processJob} from './stages';
import {DeterministicMotionPlanner} from './doubles';
import {SUPPORTED_MOTION_TYPES} from './motion-vocabulary';
import {MemoryJobRepository} from './repository';
import {CancellationRegistry} from './cancellations';
import {createRenderJob} from './jobs';
import {createSceneAnalyzer} from './llm-providers';
import type {SemanticVisionProvider} from './scene-analyzer';
import {encodePng, solidMaskPng} from './png';

test('parseRenderProgress reads renderer stdout lines', () => {
  assert.equal(parseRenderProgress('render 0%'), 0);
  assert.equal(parseRenderProgress('render 42%'), 42);
  assert.equal(parseRenderProgress('render 100%'), 100);
  assert.equal(parseRenderProgress('Rendered /out/scene01.mp4'), null);
  assert.equal(parseRenderProgress('some error'), null);
});

test('processJob runs the full pipeline and writes all artifacts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-pipeline-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const image = solidMaskPng(16, 12);
  const job = createRenderJob('job_e2e', {
    prompt: 'Drop the composition into place',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_e2e/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);

  await processJob('job_e2e', {repository, storage, renderService: new FakeRenderService()});

  const finished = await repository.get('job_e2e');
  assert.equal(finished?.status, 'completed');
  assert.equal(finished?.progress, 100);
  assert.match(finished?.outputAssetKey ?? '', /output\/scene01\.mp4$/);

  for (const key of [
    'analysis/scene-analysis.json',
    'analysis/detections.json',
    'masks/composition.png',
    'layers/composition.png',
    'layers/layers.json',
    'background/background-clean.png',
    'motion/motion-plan.json',
    'render-input.json',
    'output/scene01.mp4',
  ]) {
    assert.equal(await storage.exists(`jobs/job_e2e/${key}`), true, `missing artifact: ${key}`);
  }

  const plan = JSON.parse((await storage.get('jobs/job_e2e/motion/motion-plan.json')).toString('utf8')) as {
    camera: {type: string};
    canvas: {width: number; height: number};
    events: Array<{type: string; targetId: string; persist: boolean}>;
  };
  assert.equal(plan.camera.type, 'static');
  assert.deepEqual(plan.canvas, {width: 2560, height: 1440});
  assert.equal(plan.events[0].type, 'drop');
  assert.equal(plan.events[0].targetId, 'composition');
  assert.equal(plan.events[0].persist, true);
});

test('processJob reuses cached vision analysis for same image hash with a different prompt', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-cache-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  // Imagem distinta dos demais testes para não colidir com o cache em memória do processo.
  const image = solidMaskPng(32, 24);

  const inner = createSceneAnalyzer();
  let analyzeCalls = 0;
  const analyzer: SemanticVisionProvider = {
    analyze: (input) => {
      analyzeCalls += 1;
      return inner.analyze(input);
    },
  };

  for (const [jobId, prompt] of [['job_cache_a', 'Drop the composition into place'], ['job_cache_b', 'Reveal from left to right']]) {
    const job = createRenderJob(jobId, {
      prompt,
      durationSeconds: 8,
      width: 2560,
      height: 1440,
      fps: 30,
      inputAssetKey: `jobs/${jobId}/input/original.png`,
      outputFileName: 'scene01.mp4',
    });
    await storage.put(job.inputAssetKey!, image);
    await repository.save(job);
    await processJob(jobId, {repository, storage, renderService: new FakeRenderService(), analyzer});
    assert.equal((await repository.get(jobId))?.status, 'completed');
  }

  assert.equal(analyzeCalls, 1, 'second render with same image hash must not re-run vision');
});

test('planning_motion envia todos os gestos suportados ao planner', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-planning-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  let allowedTypes: string[] = [];
  const motionPlanner = {
    plan: async (input: {allowedMotionTypes: string[]}) => {
      allowedTypes = input.allowedMotionTypes;
      return new DeterministicMotionPlanner().plan(input as never);
    },
  };
  const handlers = buildStageHandlers({
    storage: new LocalStorageDriver(root),
    renderService: new FakeRenderService(),
    updateJob: async () => undefined,
    motionPlanner,
  });
  await handlers.planning_motion({
    image: Buffer.alloc(0),
    prompt: 'Assemble the plates',
    jobId: 'job_plan',
    input: {durationSeconds: 8, width: 2560, height: 1440, fps: 30},
    artifacts: {
      analysis: {
        version: '1', sceneId: 'scene01', source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
        compositionType: 'map',
        elements: [{
          id: 'plate', label: 'Plate', type: 'map_region', bbox: {x: 0, y: 0, width: 1, height: 1},
          confidence: 1, zIndex: 1, animatable: true, protected: false,
          motionRole: 'primary', source: 'vision',
        }],
        protectedRegions: [],
      },
      fallbackDecisions: [],
    },
  });
  assert.deepEqual(allowedTypes, [...SUPPORTED_MOTION_TYPES]);
});

test('processJob com cena não dividida aplica depth layering com parallax', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-depth-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/v1/saliency/foreground')) {
      return new Response(solidMaskPng(16, 12), {
        status: 200,
        headers: {'x-saliency-metadata': JSON.stringify({bbox: {x: 0.25, y: 0.25, width: 0.5, height: 0.5}, coverage: 0.25})},
      });
    }
    return new Response(solidMaskPng(16, 12), {status: 200}); // /v1/layers/extract
  };
  const originalVisionUrl = process.env.VISION_SERVICE_URL;
  process.env.VISION_SERVICE_URL = 'http://vision:9000';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalVisionUrl === undefined) delete process.env.VISION_SERVICE_URL;
    else process.env.VISION_SERVICE_URL = originalVisionUrl;
  });

  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const image = solidMaskPng(33, 24); // distinto dos demais testes para não colidir com o cache
  const job = createRenderJob('job_depth', {
    prompt: 'Bring the scene to life',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_depth/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);

  await processJob('job_depth', {repository, storage, renderService: new FakeRenderService()});

  const finished = await repository.get('job_depth');
  assert.equal(finished?.status, 'completed');
  assert.ok(calls.some((url) => url.includes('/v1/saliency/foreground')));
  assert.ok(calls.some((url) => url.includes('/v1/layers/extract')));
  const plan = JSON.parse(await storage.get('jobs/job_depth/motion/motion-plan.json')) as {camera: {type: string}; events: Array<{targetId: string; type: string}>};
  assert.equal(plan.camera.type, 'subtle_pan');
  assert.ok(plan.events.some((event) => event.targetId === 'depth-foreground' && event.type === 'shift'));
  const layers = JSON.parse(await storage.get('jobs/job_depth/layers/layers.json')) as Array<{targetId: string}>;
  assert.deepEqual(layers.map((layer) => layer.targetId), ['depth-foreground']);
  assert.equal(await storage.exists('jobs/job_depth/masks/depth-foreground.png'), true);
});

test('processJob com cancelamento solicitado nunca inicia o pipeline (issue #124)', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-cancel-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const cancellations = new CancellationRegistry();
  const image = solidMaskPng(40, 30); // distinto dos demais testes para não colidir com o cache
  const job = createRenderJob('job_cancelled', {
    prompt: 'Animate',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_cancelled/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);
  cancellations.request('job_cancelled');

  await processJob('job_cancelled', {repository, storage, renderService: new FakeRenderService(), cancellations});

  const saved = await repository.get('job_cancelled');
  assert.equal(saved?.status, 'cancelled');
  assert.equal(saved?.error?.code, 'CANCELLED');
  assert.equal(await storage.exists('jobs/job_cancelled/motion/motion-plan.json'), false, 'pipeline não rodou');
});
