import type {AnimationV2} from '@editorial-motion/motion-schema';
import {easedProgress} from './evaluateTimeline';

// SPEC V2 §32: o Remotion somente consulta evaluateElementAtFrame. Estado completo
// de um elemento num frame: transform + opacity + reveal + paths + overlays.

export type RevealState = {
  progress: number;
  mode: 'mask' | 'wipe';
  direction?: 'left' | 'right' | 'up' | 'down';
} | null;

export type ElementStateV2 = {
  translateX: number;
  translateY: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  reveal: RevealState;
  pathProgresses: Record<string, number>;
  overlays: {
    highlight?: number;
    dimOthers?: number;
    spotlight?: boolean;
    focusRegion?: boolean;
    underline?: number;
    circleEmphasis?: number;
  };
};

const IDENTITY: ElementStateV2 = {
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotationDeg: 0,
  opacity: 1,
  reveal: null,
  pathProgresses: {},
  overlays: {},
};

const lerp = (from: number, to: number, p: number): number => from + (to - from) * p;

// Limite editorial (§49): nenhuma layer desloca mais de 8% do canvas por eixo.
const MAX_TRANSLATION = 0.08;
const clampTranslate = (value: number): number => Math.max(-MAX_TRANSLATION, Math.min(MAX_TRANSLATION, value));

// separate/reassemble trabalham em par: o reassemble usa o offset do separate do
// mesmo track (sem estado global — avaliação pura por track).
const separateOffsetOf = (animations: readonly AnimationV2[]): {x: number; y: number} => {
  const separate = animations.find((animation) => animation.type === 'separate');
  return separate && separate.type === 'separate' ? separate.offset : {x: 0, y: 0};
};

const reassembleStartOf = (animations: readonly AnimationV2[]): number | null => {
  const starts = animations.filter((a) => a.type === 'reassemble').map((a) => a.startFrame);
  return starts.length > 0 ? Math.min(...starts) : null;
};

export const evaluateElementAtFrame = (
  animations: readonly AnimationV2[],
  frame: number,
): ElementStateV2 => {
  const state: ElementStateV2 = {
    ...IDENTITY,
    pathProgresses: {},
    overlays: {},
  };
  const stackOffset = {x: 0, y: 0};

  for (const animation of animations) {
    const p = easedProgress(animation, frame);
    switch (animation.type) {
      case 'translate':
      case 'parallax':
      case 'depth_shift':
        state.translateX += lerp(animation.from.x, animation.to.x, p);
        state.translateY += lerp(animation.from.y, animation.to.y, p);
        break;
      case 'separate': {
        // com reassemble no mesmo track, o separate libera quando o reassemble assume
        const reassembleStart = reassembleStartOf(animations);
        if (reassembleStart !== null && frame >= reassembleStart) break;
        state.translateX += animation.offset.x * p;
        state.translateY += animation.offset.y * p;
        break;
      }
      case 'reassemble': {
        // gated (não saturado): só atua dentro da janela, retornando ao repouso;
        // antes do start o elemento permanece onde o separate o deixou.
        if (frame >= animation.startFrame && frame <= animation.endFrame) {
          const offset = separateOffsetOf(animations);
          state.translateX += offset.x * (1 - p);
          state.translateY += offset.y * (1 - p);
        }
        break;
      }
      case 'stack':
        stackOffset.x += animation.order * animation.spreadRatio * p;
        stackOffset.y -= animation.order * animation.spreadRatio * p;
        break;
      case 'unstack':
        stackOffset.x += animation.order * animation.spreadRatio * (1 - p);
        stackOffset.y -= animation.order * animation.spreadRatio * (1 - p);
        break;
      case 'rotate':
        state.rotationDeg += lerp(animation.from, animation.to, p);
        break;
      case 'scale':
        state.scale *= lerp(animation.from, animation.to, p);
        break;
      case 'fade':
        state.opacity *= lerp(animation.from, animation.to, p);
        break;
      case 'node_pop':
        state.scale *= 1 + 0.06 * Math.sin(Math.PI * p);
        break;
      case 'mask_reveal':
        state.reveal = {progress: p, mode: 'mask'};
        break;
      case 'wipe_reveal':
        state.reveal = {progress: p, mode: 'wipe', direction: animation.direction};
        break;
      case 'draw_path':
      case 'draw_arrow':
      case 'line_grow':
        state.pathProgresses[animation.connectorId] = Math.max(
          state.pathProgresses[animation.connectorId] ?? 0,
          p,
        );
        break;
      case 'highlight':
        state.overlays.highlight = p;
        break;
      case 'dim_others':
        state.overlays.dimOthers = animation.strength;
        break;
      case 'spotlight':
        state.overlays.spotlight = p >= 1;
        break;
      case 'focus_region':
        state.overlays.focusRegion = p >= 1;
        break;
      case 'underline':
        state.overlays.underline = p;
        break;
      case 'circle_emphasis':
        state.overlays.circleEmphasis = p;
        break;
      case 'hold':
        break;
    }
  }

  state.translateX = clampTranslate(state.translateX + stackOffset.x);
  state.translateY = clampTranslate(state.translateY + stackOffset.y);
  return state;
};
