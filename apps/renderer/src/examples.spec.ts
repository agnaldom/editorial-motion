import assert from 'node:assert/strict';
import {open, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {before} from 'node:test';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {motionPlanSchema} from '@editorial-motion/motion-schema';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import {galleryExamples} from './examples/gallery';
import {loadSceneProps} from './scene-props';

let serveUrl = '';
before(async () => {
  serveUrl = await bundle({entryPoint: path.resolve(process.cwd(), 'src/index.ts'), webpackOverride: (config) => config});
});

// Smoke da galeria (issue #122): cada exemplo versionado tem prompt, análise e
// plano esperado; aqui o plano é validado (schema + engine) e renderizado em
// MP4 curto para garantir que produz vídeo de fato.
for (const example of galleryExamples) {
  test(`exemplo ${example.name}: plano válido renderiza MP4`, {timeout: 300_000}, async (t) => {
    const plan = motionPlanSchema.parse(example.sceneProps.plan);
    const validation = validateMotionPlan(plan, example.sceneAnalysis);
    assert.equal(validation.valid, true, validation.errors.join('; '));
    for (const motionType of example.expectedMotionTypes) {
      assert.ok(
        plan.events.some((event) => event.type === motionType) || plan.camera.type === motionType,
        `plano deveria conter o gesto esperado: ${motionType}`,
      );
    }
    const props = loadSceneProps({
      ...example.sceneProps,
      plan: {...plan, durationSeconds: 2, canvas: {width: 640, height: 360}},
    });
    const composition = await selectComposition({serveUrl, id: 'EditorialScene', inputProps: props});
    const output = path.join(tmpdir(), `em-example-${example.name}-${process.pid}.mp4`);
    try {
      await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: output, inputProps: props});
      const {size} = await stat(output);
      assert.ok(size > 0, 'MP4 não deve ser vazio');
      const handle = await open(output, 'r');
      const head = Buffer.alloc(12);
      await handle.read(head, 0, 12, 0);
      await handle.close();
      assert.equal(head.subarray(4, 8).toString('ascii'), 'ftyp', 'missing MP4 ftyp box');
    } finally {
      await rm(output, {force: true});
    }
    t.diagnostic(`${example.name}: ${example.prompt}`);
  });
}
