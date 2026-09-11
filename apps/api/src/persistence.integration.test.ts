import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRenderJob} from './jobs';
import {closeSharedVisionCache} from './cache';
import {SqlArtifactRepository, SqlJobRepository, AuditedStorageDriver} from './persistence';
import {LocalStorageDriver} from './storage';
import {RedisVisionCache} from './cache';
import {RedisJobQueue} from './redis-queue';
import {MemoryJobRepository} from './repository';
import {FakeRenderService, processJob} from './stages';
import {solidMaskPng} from './png';

// Integração com Postgres/Redis reais (issue #125): roda no CI com services
// (DATABASE_URL/REDIS_URL definidos); localmente pula sem os serviços.
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

test.after(async () => {
  await closeSharedVisionCache();
});

const withTempStorage = async (t: test.TestContext, database: string): Promise<LocalStorageDriver> => {
  const root = await mkdtemp(path.join(tmpdir(), 'em-sql-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return new LocalStorageDriver(root);
};

test('SqlJobRepository: roundtrip e activeJobs sobrevivem a "restart"', {skip: !databaseUrl && 'DATABASE_URL não configurado'}, async (t) => {
  const repo = new SqlJobRepository(databaseUrl!);
  await repo.ensureSchema();
  const job = createRenderJob('job_sql_1', {prompt: 'Move the map'});
  await repo.save(job);
  assert.equal((await repo.get('job_sql_1'))?.prompt, 'Move the map');
  // "restart": nova instância, mesma tabela
  const restarted = new SqlJobRepository(databaseUrl!);
  assert.equal((await restarted.get('job_sql_1'))?.status, 'queued');
  const active = await restarted.activeJobs();
  assert.ok(active.some((item) => item.id === 'job_sql_1'));
  await repo.close();
  await restarted.close();
});

test('AuditedStorageDriver: processJob persiste RenderArtifact com metadados §25', {skip: !databaseUrl && 'DATABASE_URL não configurado'}, async (t) => {
  const artifacts = new SqlArtifactRepository(databaseUrl!);
  await artifacts.ensureSchema();
  const storage = new AuditedStorageDriver(await withTempStorage(t, databaseUrl!), artifacts);
  const repository = new MemoryJobRepository();
  const image = solidMaskPng(44, 33); // distinto dos demais testes
  const job = createRenderJob('job_sql_e2e', {
    prompt: 'Drop the composition into place',
    durationSeconds: 8,
    width: 2560,
    height: 1440,
    fps: 30,
    inputAssetKey: 'jobs/job_sql_e2e/input/original.png',
    outputFileName: 'scene01.mp4',
  });
  await storage.put(job.inputAssetKey!, image);
  await repository.save(job);

  await processJob('job_sql_e2e', {repository, storage, renderService: new FakeRenderService()});

  const rows = await artifacts.list('job_sql_e2e');
  const types = rows.map((row) => row.type);
  for (const expected of ['source', 'mask', 'layer', 'background', 'analysis', 'motion-plan', 'video']) {
    assert.ok(types.includes(expected as never), `artefato ausente: ${expected} (tem: ${types.join(',')})`);
  }
  assert.ok(rows.every((row) => row.jobId === 'job_sql_e2e' && row.key.startsWith('jobs/job_sql_e2e/')));
  assert.ok(rows.every((row) => typeof row.metadata?.bytes === 'number'));
  await artifacts.close();
});

test('RedisVisionCache: roundtrip com TTL', {skip: !redisUrl && 'REDIS_URL não configurado'}, async () => {
  const cache = new RedisVisionCache(redisUrl!);
  await cache.set('em:test:key', '{"ok":true}');
  assert.equal(await cache.get('em:test:key'), '{"ok":true}');
  assert.equal(await cache.get('em:test:missing'), undefined);
  await cache.close();
});

test('RedisJobQueue: enqueue executa o handler e recupera de restart', {skip: !redisUrl && 'REDIS_URL não configurado'}, async (t) => {
  const keys = {pending: 'test:queue:pending', processing: 'test:queue:processing'};
  const cleanup = new (await import('ioredis')).default(redisUrl!);
  await cleanup.del(keys.pending, keys.processing);
  const handled: string[] = [];
  const queue = new RedisJobQueue(async (jobId) => {
    handled.push(jobId);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }, redisUrl!, keys);
  t.after(async () => {
    await queue.close();
    await cleanup.del(keys.pending, keys.processing);
    await cleanup.quit();
  });
  queue.enqueue('job_redis_1');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(handled, ['job_redis_1']);
});
