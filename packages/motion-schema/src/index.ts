import {z} from 'zod';

const nonNegative = z.number().finite().min(0);

export const easingNameSchema = z.enum(['linear', 'editorialOut', 'editorialInOut']);
export const motionEventTypeSchema = z.enum([
  'fade_in', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'drop',
  'scale_in', 'wipe_reveal', 'mask_reveal', 'assemble', 'draw_path', 'draw_arrow',
  'highlight', 'circle_emphasis', 'underline', 'shift', 'separate_layers', 'hold',
  // §5.4 deferidos pelo ADR-0006, implementados na forma single-target (issue #126):
  // connect (params.to), region_reveal/step_reveal (params.region/steps),
  // stack/unstack (params.order/spread), freeze (clamp de tempo por layer).
  'connect', 'region_reveal', 'step_reveal', 'stack', 'unstack', 'freeze',
]);

export const motionEventSchema = z.object({
  id: z.string().min(1),
  type: motionEventTypeSchema,
  targetId: z.string().min(1),
  start: nonNegative,
  duration: z.number().finite().positive(),
  easing: easingNameSchema.optional(),
  persist: z.boolean().optional(),
  params: z.record(z.unknown()).optional(),
}).strict();

export const cameraPlanSchema = z.object({
  type: z.enum(['static', 'subtle_zoom_in', 'subtle_zoom_out', 'subtle_pan']),
  start: nonNegative.optional(),
  duration: z.number().finite().positive().optional(),
  params: z.object({
    scaleFrom: z.number().finite().positive().optional(),
    scaleTo: z.number().finite().positive().optional(),
    xFrom: z.number().finite(),
    xTo: z.number().finite(),
    yFrom: z.number().finite(),
    yTo: z.number().finite(),
  }).partial().strict().optional(),
}).strict();

export const motionPlanSchema = z.object({
  version: z.literal('1'),
  sceneId: z.string().min(1),
  stylePreset: z.literal('editorial-documentary'),
  durationSeconds: z.number().finite().min(8),
  fps: z.number().int().positive(),
  canvas: z.object({width: z.number().int().positive(), height: z.number().int().positive()}).strict(),
  camera: cameraPlanSchema,
  events: z.array(motionEventSchema),
  finalHold: z.object({start: nonNegative, duration: z.number().finite().positive()}).strict(),
}).strict();

export type MotionPlan = z.infer<typeof motionPlanSchema>;
export type MotionEvent = z.infer<typeof motionEventSchema>;

export * from './v2';
