import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {copyFile, mkdtemp, readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {loadSceneProps, type SceneProps} from './scene-props';
import {sampleSceneProps} from './sample-scene';

const argValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const isUrl = (asset: string): boolean => /^(https?|data|file):/i.test(asset);

// ponytail: staging copies local assets next to the bundle so headless Chromium loads them over HTTP via staticFile().
const stageAssets = async (props: SceneProps): Promise<{props: SceneProps; publicDir: string}> => {
  const publicDir = await promisify(mkdtemp)(path.join(tmpdir(), 'em-render-'));
  let counter = 0;
  const stage = async (asset: string): Promise<string> => {
    if (isUrl(asset)) return asset;
    const name = `asset-${counter}${path.extname(asset) || '.png'}`;
    counter += 1;
    await promisify(copyFile)(asset, path.join(publicDir, name));
    return name;
  };
  return {
    publicDir,
    props: {
      ...props,
      background: await stage(props.background),
      layers: await Promise.all(props.layers.map(async (layer) => ({...layer, asset: await stage(layer.asset)}))),
    },
  };
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const inputPath = argValue(args, '--input');
  const output = path.resolve(argValue(args, '--output') ?? 'out/scene01.mp4');
  const timeoutMs = Number(argValue(args, '--timeout-ms') ?? 300_000);
  const loaded: SceneProps = inputPath
    ? loadSceneProps(JSON.parse(readFileSync(inputPath, 'utf8')))
    : sampleSceneProps;
  const {props, publicDir} = await stageAssets(loaded);

  try {
    const entryPoint = path.resolve(process.cwd(), 'src/index.ts');
    const serveUrl = await bundle({entryPoint, publicDir, webpackOverride: (config) => config});
    const composition = await selectComposition({serveUrl, id: 'EditorialScene', inputProps: props});

    let lastLogged = 0;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: output,
      inputProps: props,
      timeoutInMilliseconds: timeoutMs,
      onProgress: ({progress}) => {
        const percent = Math.floor(progress * 100);
        if (percent >= lastLogged + 10) {
          lastLogged = Math.floor(percent / 10) * 10;
          console.log(`render ${lastLogged}%`);
        }
      },
    });
    console.log(`Rendered ${output}`);
  } finally {
    await rm(publicDir, {recursive: true, force: true});
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
