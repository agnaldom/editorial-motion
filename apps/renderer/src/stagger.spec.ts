import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {decodePng, perceptualDiff} from './png-harness';
import type {SceneProps} from './scene-props';

const svgAsset = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">${body}</svg>`)}`;

// Plano com stagger puro (issue #118): três camadas entram em sequência
// (0.4–1.2, 1.4–2.2, 2.4–3.2) e o resto do tempo é final hold estático.
const staggerSceneProps: SceneProps = {
  background: svgAsset('<rect width="640" height="360" fill="#f4f1ea"/>'),
  plan: {
    version: '1',
    sceneId: 'stagger-sample',
    stylePreset: 'editorial-documentary',
    durationSeconds: 8,
    fps: 30,
    canvas: {width: 640, height: 360},
    camera: {type: 'static'},
    events: [
      {id: 'evt-a-fade', type: 'fade_in', targetId: 'layer-a', start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true},
      {id: 'evt-b-drop', type: 'drop', targetId: 'layer-b', start: 1.4, duration: 0.8, easing: 'editorialOut', persist: true, params: {distanceRatio: 0.08, fade: true}},
      {id: 'evt-c-drop', type: 'drop', targetId: 'layer-c', start: 2.4, duration: 0.8, easing: 'editorialOut', persist: true, params: {distanceRatio: 0.08, fade: true}},
    ],
    finalHold: {start: 3.5, duration: 4.5},
  },
  layers: [
    {elementId: 'layer-a', asset: svgAsset('<circle cx="140" cy="180" r="90" fill="#274c63"/>'), placement: {x: 0.05, y: 0.2, width: 0.27, height: 0.6, zIndex: 1}},
    {elementId: 'layer-b', asset: svgAsset('<rect x="10" y="10" width="150" height="190" rx="12" fill="#c05621"/>'), placement: {x: 0.37, y: 0.2, width: 0.27, height: 0.6, zIndex: 2}},
    {elementId: 'layer-c', asset: svgAsset('<rect x="10" y="10" width="150" height="190" rx="12" fill="#2f855a"/>'), placement: {x: 0.69, y: 0.2, width: 0.27, height: 0.6, zIndex: 3}},
  ],
};

// t=0.8s (A entrando), t=1.7s (A pronta, B entrando), t=2.8s (B pronta, C entrando), hold 3.5s→fim.
const FRAMES = [24, 51, 84, 105, 239];

test('stagger: entradas sequenciais visíveis e final hold estável', {timeout: 300_000}, async (t) => {
  const serveUrl = await bundle({entryPoint: path.resolve(process.cwd(), 'src/index.ts'), webpackOverride: (config) => config});
  const composition = await selectComposition({serveUrl, id: 'EditorialScene', inputProps: staggerSceneProps});
  const scratch = await mkdtemp(path.join(tmpdir(), 'em-stagger-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));

  const rendered = new Map<number, ReturnType<typeof decodePng>>();
  for (const frame of FRAMES) {
    const output = path.join(scratch, `stagger-${frame}.png`);
    await renderStill({composition, serveUrl, inputProps: staggerSceneProps, frame, output});
    rendered.set(frame, decodePng(readFileSync(output)));
  }
  const diff = (a: number, b: number) => perceptualDiff(rendered.get(a)!, rendered.get(b)!);

  for (const [a, b] of [[24, 51], [51, 84]] as const) {
    const {diffRatio} = diff(a, b);
    assert.ok(diffRatio > 0.005, `frames ${a} vs ${b}: entrada sequencial deveria alterar a imagem (diffRatio ${diffRatio})`);
  }
  const hold = diff(105, 239);
  assert.ok(
    hold.diffRatio <= 0.002,
    `frames 105 vs 239 deveriam ser estáveis no final hold (diffRatio ${hold.diffRatio})`,
  );
});
