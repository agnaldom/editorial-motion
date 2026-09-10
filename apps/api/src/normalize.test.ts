import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {ANALYSIS_PROXY_MAX_HEIGHT, ANALYSIS_PROXY_MAX_WIDTH, inspectImage, normalizeImage} from './normalize';

// GIF animado 1x1 com 6 frames (gerado com ffmpeg; sharp não cria imagens animadas).
const animatedGif = (): Promise<Buffer> => readFile(new URL('../../../tests/fixtures/animated.gif', import.meta.url));

test('inspectImage rejects animated images', async () => {
  await assert.rejects(inspectImage(await animatedGif()), /Animated images/);
});

test('inspectImage rejects images above the pixel limit', async () => {
  process.env.MAX_IMAGE_PIXELS = '1000';
  try {
    const big = await sharp({create: {width: 100, height: 20, channels: 3, background: '#0000ff'}}).png().toBuffer();
    await assert.rejects(() => inspectImage(big), /exceeding/);
  } finally {
    delete process.env.MAX_IMAGE_PIXELS;
  }
});

test('normalizeImage applies EXIF orientation and reports swapped dimensions', async () => {
  // 40x20 com orientation 6 (rotate 90° CW): depois do rotate, 20x40.
  const exif = await sharp({create: {width: 40, height: 20, channels: 3, background: '#00ff00'}})
    .jpeg()
    .withMetadata({orientation: 6})
    .toBuffer();
  const inspection = await inspectImage(exif);
  assert.deepEqual({width: inspection.width, height: inspection.height}, {width: 40, height: 20});
  const {proxy, scale} = await normalizeImage(exif, inspection);
  const proxyMeta = await sharp(proxy).metadata();
  assert.deepEqual({width: proxyMeta.width, height: proxyMeta.height}, {width: 20, height: 40});
  assert.deepEqual(scale.original, {width: 40, height: 20});
  assert.deepEqual(scale.analysis, {width: 20, height: 40});
  assert.equal(scale.scaleX, 2);
  assert.equal(scale.scaleY, 0.5);
});

test('normalizeImage downsizes large images to the analysis proxy bounds', async () => {
  const original = await sharp({create: {width: 4000, height: 2000, channels: 3, background: '#123456'}}).png().toBuffer();
  const inspection = await inspectImage(original);
  const {proxy, scale} = await normalizeImage(original, inspection);
  const proxyMeta = await sharp(proxy).metadata();
  assert.ok(proxyMeta.width! <= ANALYSIS_PROXY_MAX_WIDTH);
  assert.ok(proxyMeta.height! <= ANALYSIS_PROXY_MAX_HEIGHT);
  assert.equal(scale.analysis.width, proxyMeta.width);
  assert.ok(Math.abs(scale.scaleX - 4000 / proxyMeta.width!) < 1e-9);
});
