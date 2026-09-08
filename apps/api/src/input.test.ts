import assert from 'node:assert/strict';
import test from 'node:test';
import {renderInputSchema, safeOutputFileName} from './input';

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
