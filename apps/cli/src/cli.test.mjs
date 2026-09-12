import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parseArgs, runAnalyze, runPlan, runRender} from './index.mjs';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

test('parseArgs: flags com valor, booleanos e comando default', () => {
  assert.deepEqual(parseArgs(['render', '--image', 'a.png', '--prompt', 'hi', '--debug']), {
    command: 'render',
    flags: {image: 'a.png', prompt: 'hi', debug: true},
  });
  assert.equal(parseArgs(['analyze', '--image', 'a.png']).command, 'analyze');
  assert.throws(() => parseArgs(['render', 'oops']), /inesperado/);
});

test('runRender: cria job, acompanha e baixa o MP4', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'em-cli-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const imagePath = path.join(dir, 'in.png');
  await writeFile(imagePath, Buffer.from('png'));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (url.endsWith('/api/v1/renders')) {
      assert.equal(init.method, 'POST');
      return jsonResponse({jobId: 'job_1'});
    }
    if (url.endsWith('/api/v1/renders/job_1')) return jsonResponse({status: 'completed', progress: 100, stage: 'completed'});
    if (url.endsWith('/output')) return new Response(Buffer.from('mp4-bytes'));
    throw new Error(`url inesperada: ${url}`);
  };
  const result = await runRender(
    {image: imagePath, prompt: 'Animate', output: path.join(dir, 'out'), resolution: '1280x720'},
    {fetchImpl, log: () => undefined},
  );
  assert.equal(result.jobId, 'job_1');
  assert.ok(calls.includes('http://localhost:3000/api/v1/renders/job_1/output'));
  const {readFile} = await import('node:fs/promises');
  assert.equal((await readFile(result.filePath)).toString(), 'mp4-bytes');
});

test('runRender: job falho sai com código 3 (JOB_FAILED)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'em-cli-fail-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const imagePath = path.join(dir, 'in.png');
  await writeFile(imagePath, Buffer.from('png'));
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/v1/renders')) return jsonResponse({jobId: 'job_2'});
    if (url.endsWith('/api/v1/renders/job_2')) {
      return jsonResponse({status: 'failed', error: {code: 'STATIC_RENDER_DETECTED', message: 'static'}});
    }
    throw new Error(url);
  };
  await assert.rejects(
    () => runRender({image: imagePath, prompt: 'x'}, {fetchImpl, log: () => undefined}),
    (error) => error.failedJob === true && error.code === 'STATIC_RENDER_DETECTED',
  );
});

test('runPlan encadeia analyze quando --analysis não é dado', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'em-cli-plan-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const imagePath = path.join(dir, 'in.png');
  await writeFile(imagePath, Buffer.from('png'));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (url.endsWith('/api/v1/analyze')) return jsonResponse({analysis: {version: '1', sceneId: 's'}});
    if (url.endsWith('/api/v1/plan')) {
      assert.match(String(init.body), /Animate/);
      return jsonResponse({plan: {events: []}, validation: {valid: true}});
    }
    throw new Error(url);
  };
  const result = await runPlan({image: imagePath, prompt: 'Animate'}, {fetchImpl});
  assert.equal(result.validation.valid, true);
  assert.ok(calls.some((url) => url.endsWith('/api/v1/analyze')));
});

test('runAnalyze propaga erro da API com código', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'em-cli-ana-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const imagePath = path.join(dir, 'in.png');
  await writeFile(imagePath, Buffer.from('png'));
  const fetchImpl = async () => new Response('nope', {status: 415});
  await assert.rejects(
    () => runAnalyze({image: imagePath}, {fetchImpl}),
    (error) => error.code === 'API_ERROR' && error.status === 415,
  );
});
