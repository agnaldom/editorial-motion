import {copyFile, mkdtemp} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import type {SceneProps} from './scene-props';

const isUrl = (asset: string): boolean => /^(https?|data|file):/i.test(asset);

// ponytail: staging copies local assets next to the bundle so headless Chromium loads them over HTTP via staticFile().
export const stageAssets = async (props: SceneProps): Promise<{props: SceneProps; publicDir: string}> => {
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
