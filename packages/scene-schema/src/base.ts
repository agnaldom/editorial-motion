import {z} from 'zod';

export const unitInterval = z.number().finite().min(0).max(1);

export const normalizedRectSchema = z.object({
  x: unitInterval,
  y: unitInterval,
  width: unitInterval,
  height: unitInterval,
}).strict();

export type NormalizedRect = z.infer<typeof normalizedRectSchema>;
