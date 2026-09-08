import type {MotionEvent} from '@editorial-motion/motion-schema';
import type {MotionPlan} from '@editorial-motion/motion-schema';
import type {SceneAnalysis} from '@editorial-motion/scene-schema';

export type LayerState = {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  revealProgress: number;
};

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export const easing = (name: MotionEvent['easing'] | undefined, progress: number): number => {
  const t = clamp(progress);
  if (name === 'linear' || !name) return t;
  if (name === 'editorialOut') return 1 - (1 - t) ** 3;
  return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
};

const eventProgress = (frameTime: number, event: MotionEvent): number => {
  if (frameTime < event.start) return 0;
  if (frameTime >= event.start + event.duration) return 1;
  return easing(event.easing, (frameTime - event.start) / event.duration);
};

const activeOrPersisted = (frameTime: number, event: MotionEvent): boolean =>
  frameTime >= event.start && (frameTime <= event.start + event.duration || event.persist === true);

export const resolveLayerState = (
  frame: number,
  fps: number,
  events: readonly MotionEvent[],
  initial: Partial<LayerState> = {},
): LayerState => {
  const state: LayerState = {
    opacity: initial.opacity ?? 1,
    translateX: initial.translateX ?? 0,
    translateY: initial.translateY ?? 0,
    scale: initial.scale ?? 1,
    revealProgress: initial.revealProgress ?? 1,
  };
  const time = frame / fps;

  for (const event of events) {
    if (!activeOrPersisted(time, event)) continue;
    const progress = eventProgress(time, event);
    const params = event.params ?? {};
    const distance = typeof params.distanceRatio === 'number' ? params.distanceRatio : 0.08;

    switch (event.type) {
      case 'fade_in': state.opacity = progress; break;
      case 'scale_in': state.scale = progress; break;
      case 'drop': state.translateY = (1 - progress) * -distance; state.opacity = params.fade === true ? progress : state.opacity; break;
      case 'slide_up': state.translateY = (1 - progress) * distance; break;
      case 'slide_down': state.translateY = (1 - progress) * -distance; break;
      case 'slide_left': state.translateX = (1 - progress) * distance; break;
      case 'slide_right': state.translateX = (1 - progress) * -distance; break;
      case 'wipe_reveal':
      case 'mask_reveal':
      case 'draw_path':
      case 'draw_arrow': state.revealProgress = progress; break;
      default: break;
    }
  }

  return state;
};

export type MotionPlanValidation = {
  errors: string[];
  warnings: string[];
  valid: boolean;
};

/** Validates planner output before any event reaches the renderer. */
export const validateMotionPlan = (
  plan: MotionPlan,
  scene: SceneAnalysis,
): MotionPlanValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const elements = new Map(scene.elements.map((element) => [element.id, element]));
  const protectedIds = new Set([
    ...scene.elements.filter((element) => element.protected).map((element) => element.id),
    ...scene.protectedRegions.map((region) => region.id),
  ]);

  for (const event of plan.events) {
    if (!elements.has(event.targetId)) errors.push(`Unknown targetId: ${event.targetId}`);
    if (protectedIds.has(event.targetId)) errors.push(`Protected target cannot be animated: ${event.targetId}`);
    if (event.start + event.duration > plan.durationSeconds) {
      errors.push(`Event exceeds duration: ${event.id}`);
    }
  }

  const cameraParams = plan.camera.params;
  if (plan.camera.type !== 'static' && cameraParams) {
    const scaleDelta = Math.abs((cameraParams.scaleTo ?? 1) - (cameraParams.scaleFrom ?? 1));
    const panDelta = Math.max(
      Math.abs((cameraParams.xTo ?? 0) - (cameraParams.xFrom ?? 0)),
      Math.abs((cameraParams.yTo ?? 0) - (cameraParams.yFrom ?? 0)),
    );
    if (scaleDelta > 0.06) errors.push('Camera scale delta exceeds the 6% V1 limit');
    if (panDelta > 0.05) errors.push('Camera pan exceeds the 5% V1 limit');
  }

  if (plan.finalHold.duration < 1.5) {
    warnings.push('Final hold is shorter than the recommended 1.5 seconds');
  }

  return {errors, warnings, valid: errors.length === 0};
};
