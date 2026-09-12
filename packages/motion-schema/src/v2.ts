import {z} from 'zod';

// SPEC V2 §28–§29 (issue #145): Motion DSL v2 — tracks/animations com frames,
// stagger nativo (§26) e conectores SVG. Convive com o v1 (consumidores migram
// issue a issue); não reutiliza os tipos v1 de evento.

const frame = z.number().int().min(0);
const easingV2Schema = z.enum(['linear', 'easeInOutCubic', 'easeOutCubic', 'easeOutQuart', 'easeInOutQuart', 'softSpring']);

const timingShape = {
  startFrame: frame,
  endFrame: frame,
  easing: easingV2Schema.default('easeOutCubic'),
};

// Refine fica fora dos membros da união discriminada (ZodEffects quebra o
// discriminatedUnion): a checagem endFrame > startFrame acontece no track.
const timed = <T extends z.ZodRawShape>(shape: T) => z.object({...timingShape, ...shape}).strict();

const pointSchema = z.object({x: z.number().finite(), y: z.number().finite()}).strict();

export const animationV2Schemas = {
  translate: timed({type: z.literal('translate'), from: pointSchema, to: pointSchema}),
  rotate: timed({type: z.literal('rotate'), from: z.number().finite(), to: z.number().finite()}),
  scale: timed({type: z.literal('scale'), from: z.number().finite().positive(), to: z.number().finite().positive()}),
  fade: timed({type: z.literal('fade'), from: z.number().finite().min(0).max(1), to: z.number().finite().min(0).max(1)}),
  mask_reveal: timed({type: z.literal('mask_reveal')}),
  wipe_reveal: timed({type: z.literal('wipe_reveal'), direction: z.enum(['left', 'right', 'up', 'down']).default('left')}),
  separate: timed({type: z.literal('separate'), offset: pointSchema}),
  reassemble: timed({type: z.literal('reassemble')}),
  draw_path: timed({type: z.literal('draw_path'), connectorId: z.string().min(1), easing: z.literal('linear').default('linear')}),
  draw_arrow: timed({type: z.literal('draw_arrow'), connectorId: z.string().min(1), easing: z.literal('linear').default('linear')}),
  node_pop: timed({type: z.literal('node_pop')}),
  highlight: timed({type: z.literal('highlight')}),
  dim_others: timed({type: z.literal('dim_others'), strength: z.number().finite().min(0).max(1).default(0.5)}),
  spotlight: timed({type: z.literal('spotlight')}),
  focus_region: timed({type: z.literal('focus_region')}),
  parallax: timed({type: z.literal('parallax'), from: pointSchema, to: pointSchema}),
  depth_shift: timed({type: z.literal('depth_shift'), from: pointSchema, to: pointSchema}),
  stack: timed({type: z.literal('stack'), order: z.number().int().min(0), spreadRatio: z.number().finite().positive().default(0.05)}),
  unstack: timed({type: z.literal('unstack'), order: z.number().int().min(0), spreadRatio: z.number().finite().positive().default(0.05)}),
  hold: timed({type: z.literal('hold')}),
  line_grow: timed({type: z.literal('line_grow'), connectorId: z.string().min(1), easing: z.literal('linear').default('linear')}),
  underline: timed({type: z.literal('underline')}),
  circle_emphasis: timed({type: z.literal('circle_emphasis')}),
} as const;

const animationOptions = Object.values(animationV2Schemas);
export const animationV2Schema = z.discriminatedUnion(
  'type',
  animationOptions as [(typeof animationOptions)[number], ...(typeof animationOptions)[number][]],
);
export type AnimationV2 = z.infer<typeof animationV2Schema>;

export const staggerOrderSchema = z.enum([
  'left-to-right', 'right-to-left', 'top-to-bottom', 'center-out',
  'saliency-order', 'random-seeded', 'relationship-order',
]);

export const staggerSchema = z.object({
  order: staggerOrderSchema,
  frames: z.number().int().positive(),
}).strict();
export type StaggerV2 = z.infer<typeof staggerSchema>;

export const trackV2Schema = z.object({
  target: z.string().min(1),
  stagger: staggerSchema.optional(),
  animations: z.array(animationV2Schema).min(1),
}).strict().refine(
  (track) => track.animations.every((animation) => animation.endFrame > animation.startFrame),
  {message: 'endFrame must be greater than startFrame'},
);
export type TrackV2 = z.infer<typeof trackV2Schema>;

// SPEC §29 — conexões preferencialmente SVG procedural.
export const connectorV2Schema = z.object({
  id: z.string().min(1),
  type: z.enum(['bezier', 'line']),
  from: pointSchema,
  to: pointSchema,
  style: z.object({
    strokeWidth: z.number().finite().positive(),
    stroke: z.string().min(1),
  }).strict(),
}).strict();
export type ConnectorV2 = z.infer<typeof connectorV2Schema>;

export const motionPlanV2Schema = z.object({
  version: z.literal('2'),
  meta: z.object({
    durationFrames: z.number().int().positive(),
    fps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    preset: z.literal('editorial-documentary'),
  }).strict(),
  strategy: z.object({
    name: z.string().min(1),
    qualityLevel: z.number().int().min(1).max(3),
  }).strict(),
  tracks: z.array(trackV2Schema).min(1),
  connectors: z.array(connectorV2Schema).default([]),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set(plan.connectors.map((connector) => connector.id));
  for (const track of plan.tracks) {
    for (const animation of track.animations) {
      if ((animation.type === 'draw_path' || animation.type === 'draw_arrow' || animation.type === 'line_grow')
        && !ids.has(animation.connectorId)) {
        ctx.addIssue({code: z.ZodIssueCode.custom, message: `Unknown connectorId: ${animation.connectorId}`});
      }
    }
  }
});
export type MotionPlanV2 = z.infer<typeof motionPlanV2Schema>;

// ── Stagger nativo (§26) ────────────────────────────────────────────────────

export type TargetPosition = {
  x: number;
  y: number;
  saliency?: number;
};

/** Determinístico: mesma seed sempre produz a mesma ordem. */
const hashSeed = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
};

/** Ordem de um alvo dentro do stagger (0 = primeiro). */
export const staggerRank = (
  order: z.infer<typeof staggerOrderSchema>,
  position: TargetPosition,
  index: number,
  total: number,
): number => {
  switch (order) {
    case 'left-to-right': return index;
    case 'right-to-left': return total - 1 - index;
    case 'top-to-bottom': return index;
    case 'center-out': return index;
    case 'saliency-order': return index;
    case 'relationship-order': return index;
    case 'random-seeded': return hashSeed(`${position.x.toFixed(3)}:${position.y.toFixed(3)}:${index}`) % Math.max(1, total);
  }
};

/**
 * Expande o stagger de um track: desloca cada animação em `frames` por rank.
 * `positionOf` resolve o centro normalizado do alvo para ordernação espacial.
 */
export const expandTrackStagger = (
  track: TrackV2,
  rank: number,
): TrackV2 => {
  if (!track.stagger) return track;
  const shift = rank * track.stagger.frames;
  return {
    ...track,
    animations: track.animations.map((animation) => ({
      ...animation,
      startFrame: animation.startFrame + shift,
      endFrame: animation.endFrame + shift,
    })),
  };
};

/** Ordena os targets de um grupo de tracks conforme a ordem do stagger e expande. */
export const expandStaggers = (
  tracks: readonly TrackV2[],
  positionOf: (target: string) => TargetPosition,
): TrackV2[] => {
  const rankCache = new Map<string, number>();
  const rankOf = (track: TrackV2, index: number): number => {
    if (!track.stagger) return 0;
    const key = track.target;
    if (!rankCache.has(key)) {
      const position = positionOf(track.target);
      const ordered = tracks
        .filter((item) => item.stagger?.order === track.stagger?.order)
        .map((item, itemIndex) => ({item, itemIndex}))
        .sort((a, b) => {
          if (track.stagger?.order === 'left-to-right') return positionOf(a.item.target).x - positionOf(b.item.target).x;
          if (track.stagger?.order === 'right-to-left') return positionOf(b.item.target).x - positionOf(a.item.target).x;
          if (track.stagger?.order === 'top-to-bottom') return positionOf(a.item.target).y - positionOf(b.item.target).y;
          if (track.stagger?.order === 'center-out') {
            const ca = Math.hypot(positionOf(a.item.target).x - 0.5, positionOf(a.item.target).y - 0.5);
            const cb = Math.hypot(positionOf(b.item.target).x - 0.5, positionOf(b.item.target).y - 0.5);
            return ca - cb;
          }
          if (track.stagger?.order === 'saliency-order') return (positionOf(b.item.target).saliency ?? 0) - (positionOf(a.item.target).saliency ?? 0);
          return a.itemIndex - b.itemIndex;
        });
      ordered.forEach((entry, rank) => rankCache.set(entry.item.target, rank));
    }
    return rankCache.get(key) ?? 0;
  };
  return tracks.map((track, index) => expandTrackStagger(track, rankOf(track, index)));
};
