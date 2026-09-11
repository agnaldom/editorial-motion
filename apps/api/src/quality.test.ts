import assert from 'node:assert/strict';
import test from 'node:test';
import {decodePng, ssim, type Rgba} from './quality';

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
