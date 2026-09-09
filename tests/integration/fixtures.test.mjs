import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const manifest = JSON.parse(readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8'));

const pngSize = (buffer) => {
  assert.equal(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true, 'invalid PNG signature');
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
};

test('every manifest fixture has a matching generated image', () => {
  assert.equal(manifest.fixtures.length, 10);
  const onDisk = readdirSync(fixturesDir).filter((name) => name.endsWith('.png'));
  assert.equal(onDisk.length, 10, `expected 10 fixture images, found: ${onDisk.join(', ')}`);
  for (const fixture of manifest.fixtures) {
    const image = readFileSync(path.join(fixturesDir, fixture.source));
    const {width, height} = pngSize(image);
    assert.ok(width >= 640 && height >= 360, `${fixture.source} is too small for pipeline input`);
    assert.ok(image.length < 25 * 1024 * 1024, `${fixture.source} exceeds upload limit`);
  }
});
