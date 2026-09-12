import assert from 'node:assert/strict';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {annotatedVisualization, contactSheet} from './debug-artifacts';
import {commandExists} from './quality';
import {solidMaskPng} from './png';

test('annotatedVisualization desenha bbox normalizados sobre a fonte', async () => {
  const source = solidMaskPng(64, 36);
  const out = await annotatedVisualization(source, 64, 36, [
    {id: 'el-a', bbox: {x: 0.1, y: 0.1, width: 0.4, height: 0.5}, note: 'layer:0.91'},
    {id: 'el-b', bbox: {x: 0.6, y: 0.6, width: 0.3, height: 0.3}},
  ]);
  assert.ok(out.length > 0);
  // PNG 1280 de largura com proporção preservada (64:36 → 1280x720)
  assert.equal(out.readUInt32BE(16), 1280);
  assert.equal(out.readUInt32BE(20), 720);
});

test('contactSheet gera tile 4x2 a partir de vídeo real', {skip: !commandExists('ffmpeg') && 'ffmpeg indisponível'}, async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'em-sheet-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));
  const video = path.join(scratch, 'in.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=1:r=30', '-pix_fmt', 'yuv420p', video]);
  const sheet = path.join(scratch, 'sheet.jpg');
  assert.equal(contactSheet(video, 1, sheet), true);
  assert.ok((await stat(sheet)).size > 0);
});
