import assert from 'node:assert/strict';
import test from 'node:test';
import {CodedError} from './errors';
import {MAX_UPLOAD_BYTES, renderInputSchema, safeOutputFileName, validateImage} from './input';

test('applies V1 defaults', () => {
  assert.deepEqual(renderInputSchema.parse({prompt: 'Move the map'}), {
    prompt: 'Move the map', durationSeconds: 8, width: 2560, height: 1440, fps: 30, outputFileName: 'scene01.mp4',
  });
});

test('rejects durations below eight seconds', () => {
  assert.throws(() => renderInputSchema.parse({prompt: 'Move', durationSeconds: 7}));
});

test('sanitizes output names and enforces mp4', () => {
  assert.equal(safeOutputFileName('../scene final'), 'scene_final.mp4');
});

const png1px = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('validateImage usa o catálogo de erros do SPEC §18', async () => {
  await assert.rejects(() => validateImage(Buffer.alloc(0)), (error: unknown) => error instanceof CodedError && error.code === 'INVALID_INPUT');
  await assert.rejects(() => validateImage(Buffer.from('not an image at all')), (error: unknown) => error instanceof CodedError && error.code === 'UNSUPPORTED_IMAGE');
  const large = Buffer.concat([png1px, Buffer.alloc(MAX_UPLOAD_BYTES)]);
  await assert.rejects(() => validateImage(large), (error: unknown) => error instanceof CodedError && error.code === 'IMAGE_TOO_LARGE');
  await validateImage(png1px); // PNG válido passa
});
