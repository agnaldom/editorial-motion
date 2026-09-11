import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalStorageDriver} from './storage';
import {FakeRenderService, parseRenderProgress, processJob} from './stages';
import {VisionServiceClient} from './vision-client';
import {MemoryJobRepository} from './repository';
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

// Máscara "real" com ~60% de cobertura (coverage > PARTIAL_COVERAGE_THRESHOLD → strategy normal).
const realMaskPng = (width: number, height: number): Buffer => {
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4 + 3] = pixel % 5 < 3 ? 255 : 0;
  }
  return encodePng(width, height, rgba);
};

const stubGlobalFetch = (t: test.TestContext, handler: (url: string) => Response | Promise<Response>) => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
};

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}, ...init});

test('processJob usa detections, máscaras, layers e inpaint reais quando o vision-service tem providers', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-vision-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const width = 20;
  const height = 14;
  const image = solidMaskPng(width, height);
  const maskPng = realMaskPng(width, height);
  const layerPng = encodePng(width, height, Buffer.alloc(width * height * 4, 255));
  const cleanPng = encodePng(width, height, Buffer.alloc(width * height * 4, 42));

  const calls = stubGlobalFetch(t, (url) => {
    if (url.includes('/health')) {
      return jsonResponse({service: 'vision-service', provider: 'groundingdino/sam2/lama/skeleton', status: 'ok'});
    }
    if (url.includes('/v1/detect')) {
      return jsonResponse({detections: [{label: 'map route', confidence: 0.9, bbox: {x: 0.1, y: 0.15, width: 0.5, height: 0.6}}]});
    }
    if (url.includes('/v1/segment')) {
      return jsonResponse({masks: [{label: 'map route', confidence: 0.8, width, height, mask_ref: 'masks/0.png', mask_png_b64: maskPng.toString('base64')}]});
    }
    if (url.includes('/v1/layers/extract')) {
      return new Response(new Uint8Array(layerPng), {
        headers: {'content-type': 'image/png', 'x-layer-metadata': JSON.stringify({element_id: 'det_map-route', bbox: {x: 0.1, y: 0.15, width: 0.5, height: 0.6}, z_index: 1})},
      });
    }
    if (url.includes('/v1/inpaint')) {
      return new Response(new Uint8Array(cleanPng), {headers: {'content-type': 'image/png'}});
    }
    return jsonResponse({detail: 'unexpected'}, {status: 500});
  });

  const job = createRenderJob('job_vision', {
    prompt: 'Drop the composition into place',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_vision/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);

  await processJob('job_vision', {repository, storage, renderService: new FakeRenderService(), vision: new VisionServiceClient('http://vision.test')});

  const finished = await repository.get('job_vision');
  assert.equal(finished?.status, 'completed');
  assert.ok(calls.some((url) => url.includes('/v1/detect')));
  assert.ok(calls.some((url) => url.includes('/v1/segment')));
  assert.ok(calls.some((url) => url.includes('/v1/layers/extract')));
  assert.ok(calls.some((url) => url.includes('/v1/inpaint')));

  // Máscara real persistida (diferente do solidMaskPng de fallback).
  const storedMask = await storage.get('jobs/job_vision/masks/det_map-route.png');
  assert.deepEqual(storedMask, maskPng);
  assert.notDeepEqual(storedMask, solidMaskPng(width, height));

  // Layer RGBA veio do extract e o background veio do inpaint.
  assert.deepEqual(await storage.get('jobs/job_vision/layers/det_map-route.png'), layerPng);
  assert.deepEqual(await storage.get('jobs/job_vision/background/background-clean.png'), cleanPng);

  const analysis = JSON.parse((await storage.get('jobs/job_vision/analysis/scene-analysis.json')).toString('utf8')) as {
    compositionType: string;
    elements: Array<{id: string; type: string; confidence: number}>;
  };
  assert.equal(analysis.compositionType, 'mixed');
  assert.equal(analysis.elements[0].id, 'det_map-route');
  assert.equal(analysis.elements[0].type, 'route');
});

test('processJob com providers development ignora detect/segment/inpaint e segue com fallbacks', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-vision-dev-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const width = 24;
  const height = 16;
  const image = solidMaskPng(width, height);

  const calls = stubGlobalFetch(t, (url) => {
    if (url.includes('/health')) {
      return jsonResponse({service: 'vision-service', provider: 'development-null/development-null/development-copy/skeleton', status: 'ok'});
    }
    return jsonResponse({detail: 'unexpected'}, {status: 500});
  });

  const job = createRenderJob('job_vision_dev', {
    prompt: 'Drop the composition into place',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_vision_dev/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);

  await processJob('job_vision_dev', {repository, storage, renderService: new FakeRenderService(), vision: new VisionServiceClient('http://vision.test')});

  assert.equal((await repository.get('job_vision_dev'))?.status, 'completed');
  assert.equal(calls.some((url) => url.includes('/v1/detect')), false, 'detect não deve ser chamado sem provider real');
  assert.equal(calls.some((url) => url.includes('/v1/segment')), false, 'segment não deve ser chamado sem provider real');
  assert.equal(calls.some((url) => url.includes('/v1/inpaint')), false, 'inpaint não deve ser chamado sem provider real');
  assert.deepEqual(await storage.get('jobs/job_vision_dev/masks/composition.png'), solidMaskPng(width, height));
  assert.deepEqual(await storage.get('jobs/job_vision_dev/background/background-clean.png'), image);
});

test('processJob continua verde quando o vision-service está indisponível', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-vision-down-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);
  const repository = new MemoryJobRepository();
  const width = 28;
  const height = 20;
  const image = solidMaskPng(width, height);

  stubGlobalFetch(t, async () => {
    throw new Error('connection refused');
  });

  const job = createRenderJob('job_vision_down', {
    prompt: 'Drop the composition into place',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_vision_down/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);

  await processJob('job_vision_down', {repository, storage, renderService: new FakeRenderService(), vision: new VisionServiceClient('http://vision.test')});

  assert.equal((await repository.get('job_vision_down'))?.status, 'completed');
  assert.deepEqual(await storage.get('jobs/job_vision_down/masks/composition.png'), solidMaskPng(width, height));
  assert.deepEqual(await storage.get('jobs/job_vision_down/background/background-clean.png'), image);
});
