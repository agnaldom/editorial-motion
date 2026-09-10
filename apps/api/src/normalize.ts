import sharp from 'sharp';
import {z} from 'zod';

// SPEC §30: limite de pixels configurável; default cobre até 4K UHD.
export const DEFAULT_MAX_IMAGE_PIXELS = 3840 * 2160;
export const ANALYSIS_PROXY_MAX_WIDTH = 1920;
export const ANALYSIS_PROXY_MAX_HEIGHT = 1080;

export const scaleMetadataSchema = z.object({
  original: z.object({width: z.number(), height: z.number()}),
  analysis: z.object({width: z.number(), height: z.number()}),
  scaleX: z.number(),
  scaleY: z.number(),
});

export type ScaleMetadata = z.infer<typeof scaleMetadataSchema>;

export type ImageInspection = {
  width: number;
  height: number;
  format: string;
  animated: boolean;
};

export const maxImagePixels = (): number =>
  Number(process.env.MAX_IMAGE_PIXELS ?? DEFAULT_MAX_IMAGE_PIXELS);

export const inspectImage = async (buffer: Buffer): Promise<ImageInspection> => {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error('Could not decode image dimensions');
  if (width * height > maxImagePixels()) {
    throw new Error(`Image has ${width}x${height} pixels, exceeding the ${maxImagePixels()} pixel limit`);
  }
  const pages = metadata.pages ?? 1;
  if (pages > 1) throw new Error('Animated images are not supported');
  return {width, height, format: metadata.format ?? 'unknown', animated: false};
};

export type NormalizedImage = {
  proxy: Buffer;
  scale: ScaleMetadata;
};

// SPEC §8 Stage 1: EXIF orientation applied, working profile converted to
// sRGB, original preserved (upstream), analysis proxy created, scale metadata
// calculated. Geometry stays in normalized 0..1 coordinates (ADR-0003).
export const normalizeImage = async (buffer: Buffer, inspection: ImageInspection): Promise<NormalizedImage> => {
  const rotated = sharp(buffer).rotate();
  const proxy = await rotated
    .resize(ANALYSIS_PROXY_MAX_WIDTH, ANALYSIS_PROXY_MAX_HEIGHT, {fit: 'inside', withoutEnlargement: true})
    .toColorspace('srgb')
    .png()
    .toBuffer();
  const proxyMeta = await sharp(proxy).metadata();
  return {
    proxy,
    scale: {
      original: {width: inspection.width, height: inspection.height},
      analysis: {width: proxyMeta.width ?? inspection.width, height: proxyMeta.height ?? inspection.height},
      scaleX: inspection.width / (proxyMeta.width ?? inspection.width),
      scaleY: inspection.height / (proxyMeta.height ?? inspection.height),
    },
  };
};
