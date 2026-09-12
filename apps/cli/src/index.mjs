#!/usr/bin/env node
// SPEC V2 §56 (issue #154): CLI editorial-motion — client da API.
// Uso:
//   editorial-motion render --image ./in.jpg --prompt "..." [--duration 8] [--fps 30]
//       [--resolution 2560x1440] [--debug] [--output ./outputs] [--api http://localhost:3000]
//   editorial-motion analyze --image ./in.jpg [--prompt "..."]
//   editorial-motion plan --image ./in.jpg --prompt "..." | --analysis analysis.json
// Exit codes: 0 ok · 2 uso inválido · 3 job falhou · 1 erro de comunicação.

import {createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const parseArgs = (argv) => {
  const [command = 'render', ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`argumento inesperado: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return {command, flags};
};

const requireFlag = (flags, name) => {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} é obrigatório`);
  return value;
};

const parseResolution = (value) => {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? '2560x1440'));
  if (!match) throw new Error(`--resolution inválida: ${value} (esperado WxH)`);
  return {width: Number(match[1]), height: Number(match[2])};
};

const exit = (code, message) => {
  if (message) console.error(message);
  process.exitCode = code;
};

const postRender = async (apiUrl, {image, prompt, durationSeconds, fps, width, height, debug}, fetchImpl) => {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('durationSeconds', String(durationSeconds));
  form.append('fps', String(fps));
  form.append('width', String(width));
  form.append('height', String(height));
  if (debug) form.append('debug', 'true');
  form.append('image', new Blob([image]), path.basename('source.png'));
  const response = await fetchImpl(`${apiUrl}/api/v1/renders`, {method: 'POST', body: form});
  if (!response.ok) throw Object.assign(new Error(`render request failed: ${response.status}`), {code: 'API_ERROR', status: response.status});
  return (await response.json()).jobId;
};

const pollJob = async (apiUrl, jobId, {intervalMs = 2000, timeoutMs = 900_000, fetchImpl = fetch, log = console.log}) => {
  const started = Date.now();
  for (;;) {
    const response = await fetchImpl(`${apiUrl}/api/v1/renders/${jobId}`);
    if (!response.ok) throw new Error(`job status failed: ${response.status}`);
    const job = await response.json();
    log(`  [${job.status}] ${job.stage ?? ''} ${job.progress ?? 0}%`);
    if (job.status === 'completed') return job;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw Object.assign(new Error(job.error?.message ?? `job ${job.status}`), {failedJob: true, code: job.error?.code ?? 'JOB_FAILED', job});
    }
    if (Date.now() - started > timeoutMs) throw new Error(`job timeout after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

const downloadOutput = async (apiUrl, jobId, outputDir, fileName, fetchImpl) => {
  await mkdir(outputDir, {recursive: true});
  const target = path.join(outputDir, fileName);
  const response = await fetchImpl(`${apiUrl}/api/v1/renders/${jobId}/output`);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(target, bytes);
  return target;
};

export const runRender = async (flags, {fetchImpl = fetch, log = console.log} = {}) => {
  const image = await readFile(requireFlag(flags, 'image'));
  const prompt = requireFlag(flags, 'prompt');
  const apiUrl = String(flags.api ?? 'http://localhost:3000').replace(/\/$/, '');
  const {width, height} = parseResolution(flags.resolution);
  const debug = flags.debug === true;
  const jobId = await postRender(apiUrl, {
    image, prompt,
    durationSeconds: Number(flags.duration ?? 8),
    fps: Number(flags.fps ?? 30),
    width, height, debug,
  }, fetchImpl);
  log(`job ${jobId} criado — acompanhando…`);
  await pollJob(apiUrl, jobId, {fetchImpl, log});
  const filePath = await downloadOutput(apiUrl, jobId, String(flags.output ?? './outputs'), 'scene01.mp4', fetchImpl);
  log(`MP4 em ${filePath}`);
  if (debug) {
    const response = await fetchImpl(`${apiUrl}/api/v1/renders/${jobId}/analysis`);
    if (response.ok) {
      const analysis = await response.json();
      const debugDir = path.join(String(flags.output ?? './outputs'), 'debug');
      await mkdir(debugDir, {recursive: true});
      await writeFile(path.join(debugDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
      log(`debug artifacts em ${debugDir}/ (jobId ${jobId} — storage jobs/${jobId}/debug/)`);
    }
  }
  return {jobId, filePath};
};

export const runAnalyze = async (flags, {fetchImpl = fetch} = {}) => {
  const image = await readFile(requireFlag(flags, 'image'));
  const apiUrl = String(flags.api ?? 'http://localhost:3000').replace(/\/$/, '');
  const form = new FormData();
  if (flags.prompt) form.append('prompt', String(flags.prompt));
  form.append('image', new Blob([image]), 'source.png');
  const response = await fetchImpl(`${apiUrl}/api/v1/analyze`, {method: 'POST', body: form});
  if (!response.ok) throw Object.assign(new Error(`analyze failed: ${response.status}`), {code: 'API_ERROR', status: response.status});
  return response.json();
};

export const runPlan = async (flags, {fetchImpl = fetch} = {}) => {
  const apiUrl = String(flags.api ?? 'http://localhost:3000').replace(/\/$/, '');
  const prompt = requireFlag(flags, 'prompt');
  let sceneAnalysis;
  if (typeof flags.analysis === 'string') {
    sceneAnalysis = JSON.parse(await readFile(flags.analysis, 'utf8'));
  } else {
    const analyzed = await runAnalyze(flags, {fetchImpl});
    sceneAnalysis = analyzed.analysis;
  }
  const {width, height} = parseResolution(flags.resolution);
  const response = await fetchImpl(`${apiUrl}/api/v1/plan`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      prompt,
      sceneAnalysis,
      durationSeconds: Number(flags.duration ?? 8),
      fps: Number(flags.fps ?? 30),
      width,
      height,
    }),
  });
  if (!response.ok) throw Object.assign(new Error(`plan failed: ${response.status}`), {code: 'API_ERROR', status: response.status});
  return response.json();
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    return exit(2, error.message);
  }
  try {
    if (args.command === 'render') {
      await runRender(args.flags);
    } else if (args.command === 'analyze') {
      const result = await runAnalyze(args.flags);
      console.log(JSON.stringify(result, null, 2));
    } else if (args.command === 'plan') {
      const result = await runPlan(args.flags);
      console.log(JSON.stringify(result, null, 2));
    } else {
      return exit(2, `comando desconhecido: ${args.command} (render | analyze | plan)`);
    }
  } catch (error) {
    const code = error.failedJob === true ? 3 : 1;
    return exit(code, `${error.code ?? 'ERROR'}: ${error.message}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}
