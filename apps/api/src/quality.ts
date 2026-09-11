import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inflateSync} from 'node:zlib';

// SPEC §29.3: comparação final-frame ≈ source por SSIM (métrica de aviso, não gate único).
export const DEFAULT_SSIM_THRESHOLD = 0.5;
export const ssimThreshold = (): number => Number(process.env.FINAL_FRAME_SSIM_THRESHOLD ?? DEFAULT_SSIM_THRESHOLD);

export const commandExists = (command: string): boolean => {
  try {
    execFileSync(command, ['-version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
};

export type Rgba = {width: number; height: number; data: Buffer};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// PNG decode (grayscale/RGB/RGBA, 8-bit) — ffmpeg emite RGB ou RGBA.
export const decodePng = (png: Buffer): Rgba => {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      bitDepth = png[offset + 16];
      colorType = png[offset + 17];
    } else if (type === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const recon = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const source = raw[row * (stride + 1) + 1 + i];
      const left = i >= bytesPerPixel ? recon[row * stride + i - bytesPerPixel] : 0;
      const up = row > 0 ? recon[(row - 1) * stride + i] : 0;
      const upLeft = row > 0 && i >= bytesPerPixel ? recon[(row - 1) * stride + i - bytesPerPixel] : 0;
      let value: number;
      if (filter === 0) value = source;
      else if (filter === 1) value = source + left;
      else if (filter === 2) value = source + up;
      else if (filter === 3) value = source + ((left + up) >> 1);
      else if (filter === 4) value = source + paeth(left, up, upLeft);
      else throw new Error(`unsupported PNG filter: ${filter}`);
      recon[row * stride + i] = value & 0xff;
    }
  }
  if (colorType === 6) return {width, height, data: recon};
  const data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * bytesPerPixel;
    const gray = colorType === 0 || colorType === 4;
    data[pixel * 4] = recon[source];
    data[pixel * 4 + 1] = gray ? recon[source] : recon[source + 1];
    data[pixel * 4 + 2] = gray ? recon[source] : recon[source + 2];
    data[pixel * 4 + 3] = 255;
  }
  return {width, height, data};
};

const luminance = (image: Rgba): Float64Array => {
  const out = new Float64Array(image.width * image.height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.299 * image.data[i * 4] + 0.587 * image.data[i * 4 + 1] + 0.114 * image.data[i * 4 + 2];
  }
  return out;
};

/** SSIM global (janela única sobre a imagem inteira) — suficiente como métrica de aviso (§29.3). */
export const ssim = (a: Rgba, b: Rgba): number => {
  if (a.width !== b.width || a.height !== b.height) throw new Error('SSIM requires equal dimensions');
  const la = luminance(a);
  const lb = luminance(b);
  const n = la.length;
  const meanA = la.reduce((sum, v) => sum + v, 0) / n;
  const meanB = lb.reduce((sum, v) => sum + v, 0) / n;
  let va = 0;
  let vb = 0;
  let cov = 0;
  for (let i = 0; i < n; i += 1) {
    va += (la[i] - meanA) ** 2;
    vb += (lb[i] - meanB) ** 2;
    cov += (la[i] - meanA) * (lb[i] - meanB);
  }
  va /= n;
  vb /= n;
  cov /= n;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return ((2 * meanA * meanB + c1) * (2 * cov + c2)) / ((meanA ** 2 + meanB ** 2 + c1) * (va + vb + c2));
};

const COMPARE_SIZE = 256;

const toPng = (inputPath: string, outputPath: string): void => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inputPath, '-frames:v', '1', '-vf', `scale=${COMPARE_SIZE}:-2`, outputPath]);
};

/**
 * Extrai o frame final do MP4 e compara com a imagem fonte por SSIM.
 * Requer ffprobe+ffmpeg; devolve null quando indisponível (gate opcional, §29.3).
 */
export const finalFrameSsim = async (videoPath: string, sourceImage: Buffer): Promise<number | null> => {
  if (!commandExists('ffmpeg')) return null;
  const scratch = await mkdtemp(path.join(tmpdir(), 'em-quality-'));
  try {
    const sourcePath = path.join(scratch, 'source.img');
    await writeFile(sourcePath, sourceImage);
    const framePath = path.join(scratch, 'final-frame.png');
    const sourcePngPath = path.join(scratch, 'source.png');
    toPng(videoPath, framePath);
    toPng(sourcePath, sourcePngPath);
    return ssim(decodePng(readFileSync(framePath)), decodePng(readFileSync(sourcePngPath)));
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
};
