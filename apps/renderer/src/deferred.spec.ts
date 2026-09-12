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

// Tipos §5.4 deferidos pelo ADR-0006 e implementados na issue #126:
// region_reveal (janelas acumulativas), step_reveal (progresso quantizado),
// connect (linha entre dois alvos), freeze (tempo congelado por layer).
const deferredSceneProps: SceneProps = {
  background: svgAsset('<rect width="640" height="360" fill="#f4f1ea"/>'),
  plan: {
    version: '1',
    sceneId: 'deferred-sample',
    stylePreset: 'editorial-documentary',
    durationSeconds: 8,
    fps: 30,
    canvas: {width: 640, height: 360},
    camera: {type: 'static'},
    events: [
      {id: 'evt-step', type: 'step_reveal', targetId: 'chart', start: 0.5, duration: 4, easing: 'linear', persist: true, params: {steps: 4, direction: 'left'}},
      {id: 'evt-region-left', type: 'region_reveal', targetId: 'map', start: 0.5, duration: 1, easing: 'linear', persist: true, params: {region: {x: 0, y: 0, width: 0.5, height: 1}, direction: 'left'}},
      {id: 'evt-region-right', type: 'region_reveal', targetId: 'map', start: 2, duration: 1, easing: 'linear', persist: true, params: {region: {x: 0.5, y: 0, width: 0.5, height: 1}, direction: 'right'}},
      {id: 'evt-connect', type: 'connect', targetId: 'node-a', start: 3.5, duration: 1.5, easing: 'linear', persist: true, params: {to: 'node-b'}},
      {id: 'evt-shift', type: 'shift', targetId: 'node-b', start: 4.5, duration: 3.5, easing: 'linear', persist: true, params: {dxRatio: 0.1}},
      {id: 'evt-freeze', type: 'freeze', targetId: 'node-b', start: 6, duration: 0.1},
    ],
    finalHold: {start: 6.4, duration: 1.6},
  },
  layers: [
    {elementId: 'chart', asset: svgAsset('<rect width="640" height="360" fill="#274c63"/><rect x="480" width="160" height="360" fill="#c05621"/>'), placement: {x: 0.05, y: 0.03, width: 0.9, height: 0.16, zIndex: 1}},
    {elementId: 'map', asset: svgAsset('<rect width="320" height="120" fill="#4a7c59"/><rect x="320" width="320" height="120" fill="#8f5f3c"/>'), placement: {x: 0.05, y: 0.22, width: 0.9, height: 0.3, zIndex: 2}},
    {elementId: 'node-a', asset: svgAsset('<circle cx="60" cy="60" r="55" fill="#b7791f"/>'), placement: {x: 0.15, y: 0.6, width: 0.18, height: 0.32, zIndex: 3}},
    {elementId: 'node-b', asset: svgAsset('<rect x="5" y="5" width="110" height="110" rx="16" fill="#2f855a"/>'), placement: {x: 0.67, y: 0.6, width: 0.18, height: 0.32, zIndex: 4}},
  ],
};

// f48/f54: mesmo degrau do step_reveal (mapa estável na janela 1.5–2.0s);
// f78: degrau seguinte; f100: mapa completo, connect ainda não; f130: connect.
// f150: shift pre-freeze; f200/f239: pós-freeze (tempo congelado em 6.0s).
const FRAMES = [48, 54, 78, 100, 130, 150, 200, 239];

test('tipos §5.4: step quantizado, regiões acumulativas, connect e freeze visíveis', {timeout: 300_000}, async (t) => {
  const serveUrl = await bundle({entryPoint: path.resolve(process.cwd(), 'src/index.ts'), webpackOverride: (config) => ({...config, cache: false})});
  const composition = await selectComposition({serveUrl, id: 'EditorialScene', inputProps: deferredSceneProps});
  const scratch = await mkdtemp(path.join(tmpdir(), 'em-deferred-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));

  const rendered = new Map<number, ReturnType<typeof decodePng>>();
  for (const frame of FRAMES) {
    const output = path.join(scratch, `deferred-${frame}.png`);
    await renderStill({composition, serveUrl, inputProps: deferredSceneProps, frame, output});
    rendered.set(frame, decodePng(readFileSync(output)));
  }
  const diff = (a: number, b: number) => perceptualDiff(rendered.get(a)!, rendered.get(b)!);

  const sameStep = diff(48, 54);
  assert.ok(sameStep.diffRatio <= 0.002, `frames no mesmo degrau deveriam ser idênticos (diffRatio ${sameStep.diffRatio})`);
  const nextStep = diff(48, 78);
  assert.ok(nextStep.diffRatio > 0.005, `degrau seguinte deveria mudar a imagem (diffRatio ${nextStep.diffRatio})`);
  const regionsGrow = diff(78, 100);
  assert.ok(regionsGrow.diffRatio > 0.005, 'região direita deveria completar entre os frames (diffRatio ' + regionsGrow.diffRatio + ')');
  const connectDraws = diff(100, 130);
  assert.ok(connectDraws.diffRatio > 0.005, `connect deveria desenhar a linha entre os nós (diffRatio ${connectDraws.diffRatio})`);
  const shiftMoving = diff(150, 200);
  // ponytail: translação de forma sólida subconta no diff perceptual (só as bordas mudam)
  assert.ok(shiftMoving.diffRatio > 0.003, `shift deveria deslocar o nó até o freeze (diffRatio ${shiftMoving.diffRatio})`);
  const frozen = diff(200, 239);
  assert.ok(frozen.diffRatio <= 0.002, `após freeze os frames deveriam ser idênticos (diffRatio ${frozen.diffRatio})`);
});
