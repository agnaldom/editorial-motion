import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {open, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {sampleSceneProps} from './sample-scene';
import {stageAssets} from './stage-assets';

const commandExists = (command: string): boolean => {
  try {
    execFileSync(command, ['-version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
};

test('smoke: renderer produz MP4 curto valido (h264, 640x360, ~2s)', async () => {
  const {props, publicDir} = await stageAssets({
    ...sampleSceneProps,
    plan: {...sampleSceneProps.plan, durationSeconds: 2, canvas: {width: 640, height: 360}},
  });
  const output = path.join(tmpdir(), `em-smoke-${process.pid}.mp4`);
  try {
    const entryPoint = path.resolve(process.cwd(), 'src/index.ts');
    const serveUrl = await bundle({entryPoint, publicDir, webpackOverride: (config) => ({...config, cache: false})});
    const composition = await selectComposition({serveUrl, id: 'EditorialScene', inputProps: props});
    await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: output, inputProps: props});

    const {size} = await stat(output);
    assert.ok(size > 0, 'MP4 should not be empty');
    const handle = await open(output, 'r');
    const head = Buffer.alloc(12);
    await handle.read(head, 0, 12, 0);
    await handle.close();
    assert.equal(head.subarray(4, 8).toString('ascii'), 'ftyp', 'missing MP4 ftyp box');

    if (commandExists('ffprobe')) {
      const probe = (field: string): string =>
        execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', field, '-of', 'default=nw=1:nk=1', output])
          .toString().trim();
      assert.equal(probe('stream=codec_name'), 'h264');
      assert.equal(probe('stream=width'), '640');
      assert.equal(probe('stream=height'), '360');
      const duration = Number(probe('format=duration'));
      assert.ok(duration > 1.8 && duration < 2.2, `expected ~2s, got ${duration}s`);
    } else {
      console.log('smoke: ffprobe indisponivel; checagens profundas puladas');
    }
  } finally {
    await rm(publicDir, {recursive: true, force: true});
    await rm(output, {force: true});
  }
});
