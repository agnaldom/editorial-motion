import type {AnimationV2} from '@editorial-motion/motion-schema';
import {easingV2, type EasingV2Name} from './easing';

// SPEC V2 §32 (issue #146): timeline evaluation. Fora da janela o progresso é
// saturado (0 antes, 1 depois) — entrances começam no `from` sem evento pré-start.

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const animationProgress = (animation: AnimationV2, frame: number): number => {
  if (frame <= animation.startFrame) return 0;
  if (frame >= animation.endFrame) return 1;
  return (frame - animation.startFrame) / (animation.endFrame - animation.startFrame);
};

export const easedProgress = (animation: AnimationV2, frame: number): number => {
  const easing = ('easing' in animation ? animation.easing : 'easeOutCubic') as EasingV2Name;
  return easingV2(easing, animationProgress(animation, frame));
};
