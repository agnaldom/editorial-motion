import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalStorageDriver} from './storage';

test('storage roundtrips data and rejects traversal keys', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-storage-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const storage = new LocalStorageDriver(root);

  await storage.put('jobs/job_1/output/scene01.mp4', Buffer.from('video'));
  assert.equal(await storage.exists('jobs/job_1/output/scene01.mp4'), true);
  assert.deepEqual(await storage.get('jobs/job_1/output/scene01.mp4'), Buffer.from('video'));
  assert.equal(storage.resolvePath('jobs/job_1/x.json').startsWith(root), true);

  await assert.rejects(() => storage.put('../evil.txt', 'x'), /Invalid storage key/);
  await assert.rejects(() => storage.put('jobs/../../evil.txt', 'x'), /Invalid storage key/);
  await assert.rejects(() => storage.put('/abs/evil.txt', 'x'), /Invalid storage key/);
});
