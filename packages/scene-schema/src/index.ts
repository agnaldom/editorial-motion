import {z} from 'zod';

const unitInterval = z.number().finite().min(0).max(1);

export const normalizedRectSchema = z.object({
  x: unitInterval,
  y: unitInterval,
  width: unitInterval,
  height: unitInterval,
}).strict();

export const sceneElementTypeSchema = z.enum([
  'cutout', 'map_region', 'route', 'arrow', 'icon', 'photo', 'document',
  'chart', 'text', 'stat_box', 'background', 'decorative',
]);

export const sceneElementSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: sceneElementTypeSchema,
  bbox: normalizedRectSchema,
  confidence: unitInterval,
  zIndex: z.number().int().finite(),
  animatable: z.boolean(),
  protected: z.boolean(),
  motionRole: z.enum(['primary', 'secondary', 'connector', 'static', 'protected']),
  source: z.enum(['vision', 'detector', 'derived']),
  maskRef: z.string().min(1).optional(),
  layerRef: z.string().min(1).optional(),
  relationshipIds: z.array(z.string().min(1)).optional(),
}).strict();

export const protectedRegionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  bbox: normalizedRectSchema,
  reason: z.string().min(1),
}).strict();

export const sceneAnalysisSchema = z.object({
  version: z.literal('1'),
  sceneId: z.string().min(1),
  source: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.number().finite().positive(),
  }).strict(),
  compositionType: z.enum(['editorial-collage', 'map', 'diagram', 'infographic', 'photo', 'mixed']),
  elements: z.array(sceneElementSchema).max(10),
  protectedRegions: z.array(protectedRegionSchema),
}).strict();

export type NormalizedRect = z.infer<typeof normalizedRectSchema>;
export type SceneElement = z.infer<typeof sceneElementSchema>;
export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;
