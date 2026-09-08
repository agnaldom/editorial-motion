import {fileTypeFromBuffer} from 'file-type';
import {z} from 'zod';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_DURATION_SECONDS = 20;
export const supportedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const renderInputSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  durationSeconds: z.coerce.number().finite().min(8).max(MAX_DURATION_SECONDS).default(8),
  width: z.coerce.number().int().positive().max(3840).default(2560),
  height: z.coerce.number().int().positive().max(2160).default(1440),
  fps: z.coerce.number().int().positive().max(60).default(30),
  outputFileName: z.string().trim().min(1).max(128).optional().default('scene01.mp4'),
}).strict();

export type RenderInput = z.infer<typeof renderInputSchema>;

export const validateImage = async (buffer: Buffer): Promise<void> => {
  if (buffer.length === 0) throw new Error('Image file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Image exceeds the 25 MB limit');
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !supportedImageMimeTypes.includes(detected.mime as typeof supportedImageMimeTypes[number])) {
    throw new Error('Only PNG, JPEG, and WebP images are supported');
  }
}

export const safeOutputFileName = (name: string): string => {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^[._-]+/, '');
  return base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`;
};
