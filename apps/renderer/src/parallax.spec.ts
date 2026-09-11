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

// Depth layering (issue #121): plano de fundo original + foreground recortado.
// Câmera em pan mínimo (até 6.4s) e foreground em shift oposto — o deslocamento
// RELATIVO entre os planos é o parallax.
const parallaxSceneProps: SceneProps = {
  background: svgAsset('<rect width="640" height="360" fill="#e2ddd2"/><rect x="40" y="40" width="560" height="280" rx="16" fill="#f4f1ea"/>'),
  plan: {
    version: '1',
    sceneId: 'depth-sample',
    stylePreset: 'editorial-documentary',
    durationSeconds: 8,
    fps: 30,
    canvas: {width: 640, height: 360},
    camera: {type: 'subtle_pan', start: 0, duration: 6.4, params: {xFrom: -0.02, xTo: 0.02}},
    events: [
      {id: 'evt-fg-fade', type: 'fade_in', targetId: 'depth-foreground', start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true},
      {id: 'evt-fg-shift', type: 'shift', targetId: 'depth-foreground', start: 1.4, duration: 5, easing: 'editorialInOut', persist: true, params: {dxRatio: -0.03}},
    ],
    finalHold: {start: 6.4, duration: 1.6},
  },
  layers: [
    {elementId: 'depth-foreground', asset: svgAsset('<circle cx="110" cy="105" r="80" fill="#274c63"/>'), placement: {x: 0.2, y: 0.15, width: 0.35, height: 0.7, zIndex: 1}},
  ],
};

// t=0.8s (fade), t=3.5s (shift meio), t=7.0s (pan/shift encerrados), t=7.97s (hold).
const FRAMES = [24, 105, 210, 239];

test('depth layering: parallax visível entre planos e final hold estável', {timeout: 300_000}, async (t) => {
  const serveUrl = await bundle({entryPoint: path.resolve(process.cwd(), 'src/index.ts'), webpackOverride: (config) => config});
  const composition = await selectComposition({serveUrl, id: 'EditorialScene', inputProps: parallaxSceneProps});
  const scratch = await mkdtemp(path.join(tmpdir(), 'em-parallax-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));

  const rendered = new Map<number, ReturnType<typeof decodePng>>();
  for (const frame of FRAMES) {
    const output = path.join(scratch, `parallax-${frame}.png`);
    await renderStill({composition, serveUrl, inputProps: parallaxSceneProps, frame, output});
    rendered.set(frame, decodePng(readFileSync(output)));
  }
  const diff = (a: number, b: number) => perceptualDiff(rendered.get(a)!, rendered.get(b)!);

  const entering = diff(24, 105);
  assert.ok(entering.diffRatio > 0.005, `frames 24 vs 105: parallax deveria deslocar os planos (diffRatio ${entering.diffRatio})`);
  const moving = diff(105, 210);
  assert.ok(moving.diffRatio > 0.005, `frames 105 vs 210: deslocamento relativo deveria continuar (diffRatio ${moving.diffRatio})`);
  const hold = diff(210, 239);
  assert.ok(hold.diffRatio <= 0.002, `frames 210 vs 239 deveriam ser estáveis após pan/shift (diffRatio ${hold.diffRatio})`);
});
