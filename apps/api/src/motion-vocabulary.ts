import type {SceneElement} from '@editorial-motion/scene-schema';

// Catálogo de gestos efetivamente suportados por engine+renderer (issue #118).
// Manter sincronizado com motionEventTypeSchema e com resolveLayerState/GeneratedOverlay.
export const SUPPORTED_MOTION_TYPES: readonly string[] = [
  'fade_in', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'drop',
  'scale_in', 'wipe_reveal', 'mask_reveal', 'assemble', 'draw_path', 'draw_arrow',
  'highlight', 'circle_emphasis', 'underline', 'shift', 'separate_layers', 'hold',
  'connect', 'region_reveal', 'step_reveal', 'stack', 'unstack', 'freeze',
];

export type VerbHint = {
  pattern: RegExp;
  types: readonly string[];
  note: string;
};

// Tabela explícita verbo→gesto, refletida em docs/motion-style.md e testada em motion-vocabulary.test.ts.
export const VERB_HINTS: readonly VerbHint[] = [
  {pattern: /\b(assembl\w*|monta\w*)\b/i, types: ['assemble'], note: 'assemble → montagem sequencial com stagger (0.3–0.7s entre elementos)'},
  {pattern: /\b(draw|trace|sketch|desenha\w*|tra[çc]\w*)\b/i, types: ['draw_path', 'draw_arrow'], note: 'draw/trace → draw_path/draw_arrow em route/arrow, easing linear, persist true'},
  {pattern: /\b(wipe)\b/i, types: ['wipe_reveal'], note: 'wipe → wipe_reveal com params.direction (left|right|up|down)'},
  {pattern: /\b(reveal|revela\w*|unveil)\b/i, types: ['mask_reveal', 'wipe_reveal'], note: 'reveal → mask_reveal (círculo do centro) ou wipe_reveal por direção'},
  {pattern: /\b(highlight|emphas\w*|destaca\w*)\b/i, types: ['highlight', 'circle_emphasis'], note: 'highlight/emphasize → highlight ou circle_emphasis com persist true'},
  {pattern: /\b(underline|sublinha\w*)\b/i, types: ['underline'], note: 'underline → underline com persist true'},
  {pattern: /\b(separate|spread|apart|separa\w*)\b/i, types: ['separate_layers'], note: 'separate/spread → separate_layers com params.direction e distanceRatio ≤ 0.1'},
  {pattern: /\b(shift|move|push|slide|mova?)\b/i, types: ['shift', 'slide_up', 'slide_down', 'slide_left', 'slide_right'], note: 'shift/move → shift (dxRatio/dyRatio) ou slide_* com distanceRatio ≤ 0.15'},
  {pattern: /\b(drop)\b/i, types: ['drop'], note: 'drop → drop com distanceRatio 0.05–0.15 e fade true'},
  {pattern: /\b(scale|grow)\b/i, types: ['scale_in'], note: 'scale/grow → scale_in a partir do anchor'},
  {pattern: /\b(fade)\b/i, types: ['fade_in'], note: 'fade → fade_in'},
  {pattern: /\b(freeze|lock|persist|congela\w*|trava\w*)\b/i, types: [], note: 'freeze/lock → persist true nos eventos do alvo (estado final se mantém)'},
];

const DRAW_TYPES = new Set(['draw_path', 'draw_arrow']);
const OVERLAY_TYPES = new Set(['highlight', 'circle_emphasis', 'underline']);

export const isOverlayTypeHint = (type: string): boolean => OVERLAY_TYPES.has(type);

// ponytail: o papel do elemento decide a aplicabilidade; protected/static continua filtrado pelo planner.
export const appliesTo = (type: string, element: Pick<SceneElement, 'type' | 'animatable' | 'protected' | 'motionRole'>): boolean => {
  if (!element.animatable || element.protected) return false;
  if (element.motionRole === 'static' || element.motionRole === 'protected') return false;
  if (type === 'hold') return false; // hold é composicional, não uma entrada
  if (DRAW_TYPES.has(type)) return element.type === 'route' || element.type === 'arrow';
  if (type === 'assemble') return element.motionRole !== 'connector'; // conectores desenham, não montam
  return true;
};

export const gesturesForPrompt = (prompt: string): VerbHint[] => VERB_HINTS.filter((hint) => hint.pattern.test(prompt));

/** Textos de hint para o system/user prompt do LLM planner. */
export const gestureNotesForPrompt = (prompt: string): string[] => gesturesForPrompt(prompt).map((hint) => hint.note);

/** Primeiro gesto da tabela que se aplica ao elemento; default preserva o comportamento legado (drop). */
export const primaryGestureForPrompt = (prompt: string, element: Parameters<typeof appliesTo>[1]): string => {
  for (const hint of gesturesForPrompt(prompt)) {
    for (const type of hint.types) if (appliesTo(type, element)) return type;
  }
  return 'drop';
};

/** Params por tipo de gesto para o planner determinístico. */
export const paramsForGesture = (type: string): Record<string, unknown> | undefined => {
  if (type === 'drop') return {distanceRatio: 0.08, fade: true};
  if (type.startsWith('slide_')) return {distanceRatio: 0.08};
  if (type === 'wipe_reveal') return {direction: 'left'};
  if (type === 'separate_layers') return {direction: 'down', distanceRatio: 0.08};
  return undefined;
};
