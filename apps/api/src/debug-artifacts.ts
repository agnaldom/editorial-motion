import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {commandExists} from './quality';

// SPEC V2 §51–§52 (issue #149): artefatos de debug — contact sheet e visualização
// com bounding boxes (somente no modo debug).

export const contactSheet = (videoPath: string, durationSeconds: number, outputPath: string): boolean => {
  if (!commandExists('ffmpeg')) return false;
  const fps = Math.max(1, Math.round(8 / Math.max(0.5, durationSeconds)));
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', videoPath,
    '-vf', `fps=${fps},scale=320:-2,tile=4x2`,
    '-frames:v', '1', '-q:v', '3', outputPath,
  ]);
  return true;
};

export type AnnotationBox = {
  id: string;
  bbox: {x: number; y: number; width: number; height: number};
  note?: string;
};

/** bbox normalizados sobre a imagem fonte — bounding boxes SOMENTE no modo debug (§52). */
export const annotatedVisualization = async (
  sourceImage: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  boxes: readonly AnnotationBox[],
): Promise<Buffer> => {
  const W = 1280;
  const H = Math.round((sourceHeight / sourceWidth) * W);
  const rects = boxes.map((box) => {
    const x = box.bbox.x * W;
    const y = box.bbox.y * H;
    const w = box.bbox.width * W;
    const h = box.bbox.height * H;
    const label = `${box.id}${box.note ? `: ${box.note}` : ''}`;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="#f59e0b" stroke-width="2"/>
      <text x="${(x + 4).toFixed(1)}" y="${(y + 16).toFixed(1)}" font-family="monospace" font-size="13" fill="#f59e0b">${label}</text>`;
  }).join('\n');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`);
  return sharp(sourceImage).resize(W, H).composite([{input: svg}]).png().toBuffer();
};
