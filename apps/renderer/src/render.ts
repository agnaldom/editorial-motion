import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {loadSceneProps, type SceneProps} from './scene-props';
import {sampleSceneProps} from './sample-scene';
import {stageAssets} from './stage-assets';

const argValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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

    let lastLogged = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: output,
      inputProps: props,
      timeoutInMilliseconds: timeoutMs,
      onProgress: ({progress}) => {
        // 1% de granularidade: a API consome essas linhas para progresso real do job.
        const percent = Math.floor(progress * 100);
        if (percent > lastLogged) {
          lastLogged = percent;
          console.log(`render ${percent}%`);
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
