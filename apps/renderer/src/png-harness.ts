import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';

export type Rgba = {width: number; height: number; data: Buffer};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Minimal PNG decode (grayscale/RGB/RGBA, 8-bit) — enough for perceptual diff of stills.
export const decodePng = (png: Buffer): Rgba => {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      bitDepth = png[offset + 16];
      colorType = png[offset + 17];
    } else if (type === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![0, 2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const recon = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const source = raw[row * (stride + 1) + 1 + i];
      const left = i >= bytesPerPixel ? recon[row * stride + i - bytesPerPixel] : 0;
      const up = row > 0 ? recon[(row - 1) * stride + i] : 0;
      const upLeft = row > 0 && i >= bytesPerPixel ? recon[(row - 1) * stride + i - bytesPerPixel] : 0;
      let value: number;
      if (filter === 0) value = source;
      else if (filter === 1) value = source + left;
      else if (filter === 2) value = source + up;
      else if (filter === 3) value = source + ((left + up) >> 1);
      else if (filter === 4) value = source + paeth(left, up, upLeft);
      else throw new Error(`unsupported PNG filter: ${filter}`);
      recon[row * stride + i] = value & 0xff;
    }
  }
  if (colorType === 6) return {width, height, data: recon};
  const data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * bytesPerPixel;
    const gray = colorType === 0;
    data[pixel * 4] = recon[source];
    data[pixel * 4 + 1] = gray ? recon[source] : recon[source + 1];
    data[pixel * 4 + 2] = gray ? recon[source] : recon[source + 2];
    data[pixel * 4 + 3] = 255;
  }
  return {width, height, data};
};

// Perceptual tolerance: a small ratio of pixels may deviate beyond the channel delta
// (font rasterization, Chromium version skew across environments — never byte equality).
export const perceptualDiff = (actual: Rgba, expected: Rgba, maxChannelDelta = 14): {diffRatio: number; meanDelta: number} => {
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  let beyond = 0;
  let totalDelta = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(actual.data[i] - expected.data[i]),
      Math.abs(actual.data[i + 1] - expected.data[i + 1]),
      Math.abs(actual.data[i + 2] - expected.data[i + 2]),
    );
    totalDelta += delta;
    if (delta > maxChannelDelta) beyond += 1;
  }
  return {diffRatio: beyond / (actual.width * actual.height), meanDelta: totalDelta / (actual.width * actual.height)};
};
