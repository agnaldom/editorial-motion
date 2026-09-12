import assert from 'node:assert/strict';
import test from 'node:test';
import {commandExists, decodePng, ssim, type Rgba} from './quality';

const solid = (width: number, height: number, rgb: [number, number, number]): Rgba => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return {width, height, data};
};

const gradient = (width: number, height: number, invert = false): Rgba => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const value = invert ? 255 - Math.round((x / width) * 255) : Math.round((x / width) * 255);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return {width, height, data};
};

test('ssim: idêntico = 1.0; estrutura invertida ≈ negativo; variação sutil ≈ alto', () => {
  const a = gradient(64, 36);
  assert.equal(ssim(a, a), 1);
  assert.ok(ssim(a, gradient(64, 36, true)) < 0, 'gradiente invertido deveria ter SSIM negativo');
  const subtle = gradient(64, 36);
  subtle.data[0] = 200; // um pixel fora do lugar
  assert.ok(ssim(a, subtle) > 0.95, `variação sutil deveria manter SSIM alto, got ${ssim(a, subtle)}`);
});

test('ssim: exige dimensões iguais', () => {
  assert.throws(() => ssim(solid(8, 8, [0, 0, 0]), solid(8, 4, [0, 0, 0])), /equal dimensions/);
});

const png1px = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('decodePng lê PNG grayscale/RGB/RGBA', () => {
  const decoded = decodePng(png1px);
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  assert.equal(decoded.data.length, 4);
});

import {analyzeMotion, postRenderQuality, type Rgba} from './quality';

const frame = (shade: number): Rgba => {
  const data = Buffer.alloc(64 * 36 * 4);
  for (let i = 0; i < 64 * 36; i += 1) {
    data[i * 4] = shade;
    data[i * 4 + 1] = shade;
    data[i * 4 + 2] = shade;
    data[i * 4 + 3] = 255;
  }
  return {width: 64, height: 36, data};
};

test('analyzeMotion: frames idênticos → timelineActivity 0, finalHoldRatio 1 (STATIC)', () => {
  const metrics = analyzeMotion([frame(100), frame(100), frame(100), frame(100)]);
  assert.equal(metrics.timelineActivity, 0);
  assert.equal(metrics.finalHoldRatio, 1);
  assert.equal(metrics.frameDifference, 0);
});

test('analyzeMotion: movimento contínuo → activity 1, hold no rabo medido', () => {
  const moving = [frame(50), frame(100), frame(150), frame(200), frame(200), frame(200)];
  const metrics = analyzeMotion(moving);
  assert.equal(metrics.timelineActivity, 0.6, '3 pares em movimento, 2 de hold final');
  assert.ok(metrics.frameDifference > 0.5);
  assert.ok(Math.abs(metrics.finalHoldRatio - 2 / 5) < 0.01, `hold ratio ${metrics.finalHoldRatio}`);
});

test('postRenderQuality: vídeo estático real → STATIC_RENDER_DETECTED (§62)', {skip: !commandExists('ffmpeg') && 'ffmpeg indisponível'}, async (t) => {
  const {mkdtemp} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const path = await import('node:path');
  const {execFileSync} = await import('node:child_process');
  const {rm} = await import('node:fs/promises');
  const scratch = await mkdtemp(path.join(tmpdir(), 'em-qg-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));
  const staticVideo = path.join(scratch, 'static.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1', '-pix_fmt', 'yuv420p', staticVideo]);
  const report = await postRenderQuality(staticVideo, 1);
  assert.ok(report);
  assert.equal(report.renderPassed, false);
  assert.equal(report.code, 'STATIC_RENDER_DETECTED');

  const movingVideo = path.join(scratch, 'moving.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=1:r=30', '-pix_fmt', 'yuv420p', movingVideo]);
  const movingReport = await postRenderQuality(movingVideo, 1);
  assert.ok(movingReport);
  assert.equal(movingReport.renderPassed, true, JSON.stringify(movingReport.metrics));
  assert.ok(movingReport.metrics.timelineActivity >= 0.5);
});
