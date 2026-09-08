import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'node:path';

const output = path.resolve(process.cwd(), 'out/scene01.mp4');
const entryPoint = path.resolve(process.cwd(), 'src/index.ts');
const serveUrl = await bundle({entryPoint, webpackOverride: (config) => config});
const composition = await selectComposition({serveUrl, id: 'EditorialScene'});

await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: output});
console.log(`Rendered ${output}`);
