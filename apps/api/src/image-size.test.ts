import assert from 'node:assert/strict';
import test from 'node:test';
import {imageSize} from './image-size';
import {solidMaskPng} from './png';

test('reads PNG dimensions', () => {
  assert.deepEqual(imageSize(solidMaskPng(37, 11)), {width: 37, height: 11});
});

test('reads WebP VP8X dimensions', () => {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUIntLE(639, 24, 3);
  buffer.writeUIntLE(479, 27, 3);
  assert.deepEqual(imageSize(buffer), {width: 640, height: 480});
});

test('reads JPEG SOF0 dimensions', () => {
  const sof = Buffer.alloc(15);
  sof.writeUInt16BE(15, 0);
  sof.writeUInt8(8, 2);
  sof.writeUInt16BE(480, 3);
  sof.writeUInt16BE(640, 5);
  const buffer = Buffer.concat([Buffer.from([0xFF, 0xD8]), Buffer.from([0xFF, 0xC0]), sof, Buffer.from([0xFF, 0xD9])]);
  assert.deepEqual(imageSize(buffer), {width: 640, height: 480});
});

test('rejects non-image data', () => {
  assert.throws(() => imageSize(Buffer.from('not an image')), /Unsupported or corrupt/);
});
