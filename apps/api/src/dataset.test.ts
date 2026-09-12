import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {validateSceneGraph, type SceneAnalysis} from '@editorial-motion/scene-schema';
import {LocalStorageDriver} from './storage';
import {MemoryJobRepository} from './repository';
import {createRenderJob} from './jobs';
import {FakeRenderService, processJob} from './stages';

// SPEC V2 §59/§61-15 (issue #152): o sistema não pode ser validado só com o mapa.
// Smoke de pipeline por imagem heterogênea: analyzer double com a classificação
// semântica do caso; assertivas de classificação exatas ficam no pytest do
// vision-service (test_dataset.py) — lá a heurística roda sobre os pixels reais.

const fixturesDir = path.resolve(process.cwd(), '../../tests/fixtures/v2');
const manifest = JSON.parse(readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8')) as {
  cases: Array<{id: string; source: string; semanticType: string}>,
};

const compositionBySemantic: Record<string, SceneAnalysis['compositionType']> = {
  map: 'map', diagram: 'diagram', infographic: 'infographic', 'editorial-collage': 'editorial-collage',
  document: 'infographic', screenshot: 'diagram', 'data-visualization': 'infographic',
  photo: 'photo', portrait: 'photo', landscape: 'photo', product: 'photo',
  architecture: 'diagram', illustration: 'mixed', abstract: 'mixed',
};

const analysisFor = (semanticType: string): SceneAnalysis => ({
  version: '1',
  sceneId: 'dataset-case',
  source: {width: 1280, height: 720, aspectRatio: 16 / 9},
  compositionType: compositionBySemantic[semanticType] ?? 'mixed',
  classifications: [{type: semanticType, confidence: 0.9}],
  elements: [
    {id: 'subject-1', label: 'Subject', type: 'cutout', bbox: {x: 0.15, y: 0.2, width: 0.3, height: 0.4}, confidence: 0.9, zIndex: 1, animatable: true, protected: false, motionRole: 'primary', source: 'vision', layerability: 0.9},
    {id: 'subject-2', label: 'Support', type: 'cutout', bbox: {x: 0.55, y: 0.25, width: 0.25, height: 0.35}, confidence: 0.85, zIndex: 2, animatable: true, protected: false, motionRole: 'secondary', source: 'vision', layerability: 0.85},
  ],
  protectedRegions: [],
});

for (const testCase of manifest.cases) {
  test(`dataset ${testCase.id}: pipeline completo com imagem heterogênea`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), `em-ds-${testCase.id}-`));
    t.after(() => rm(root, {recursive: true, force: true}));
    const storage = new LocalStorageDriver(root);
    const repository = new MemoryJobRepository();
    const image = readFileSync(path.join(fixturesDir, testCase.source));
    const job = createRenderJob(`job_ds_${testCase.id}`, {
      prompt: 'Animate this as a premium editorial explainer',
      durationSeconds: 8,
      width: 2560,
      height: 1440,
      fps: 30,
      inputAssetKey: `jobs/job_ds_${testCase.id}/input/original.png`,
      outputFileName: 'scene01.mp4',
      debug: true,
    });
    await storage.put(job.inputAssetKey!, image);
    await repository.save(job);
    const analyzer = {analyze: async () => analysisFor(testCase.semanticType)};

    await processJob(job.id, {repository, storage, renderService: new FakeRenderService(), analyzer});

    const finished = await repository.get(job.id);
    assert.equal(finished?.status, 'completed', `${testCase.id}: ${JSON.stringify(finished?.error)}`);
    const graph = validateSceneGraph(JSON.parse(await storage.get(`jobs/${job.id}/debug/scene-graph.json`)));
    assert.equal(graph.valid, true, graph.errors.join('; '));
    const strategies = JSON.parse(await storage.get(`jobs/${job.id}/debug/strategy-scores.json`)) as {selected: string};
    assert.ok(strategies.selected.length > 0, 'strategy selecionada registrada');
    const plan = JSON.parse(await storage.get(`jobs/${job.id}/motion/motion-plan.json`)) as {events: unknown[]};
    assert.ok(plan.events.length >= 1, 'plano com eventos');
  });
}
