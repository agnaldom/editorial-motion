import type {MotionPlan} from '@editorial-motion/motion-schema';
import type {SceneLayerPlacement} from './components/SceneLayer';

export type SceneLayerSpec = {
  elementId: string;
  asset: string;
  placement: SceneLayerPlacement;
};

export type SceneProps = {
  plan: MotionPlan;
  background: string;
  layers: SceneLayerSpec[];
};

const cameraTypes = new Set(['static', 'subtle_zoom_in', 'subtle_zoom_out', 'subtle_pan']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const validatePlan = (plan: unknown): MotionPlan => {
  if (!isRecord(plan)) throw new Error('Invalid scene props: "plan" must be an object');
  if (!isPositiveNumber(plan.durationSeconds)) throw new Error('Invalid scene props: plan.durationSeconds must be a positive number');
  if (typeof plan.fps !== 'number' || !Number.isInteger(plan.fps) || plan.fps <= 0) {
    throw new Error('Invalid scene props: plan.fps must be a positive integer');
  }
  if (!isRecord(plan.canvas) || !isPositiveNumber(plan.canvas.width) || !isPositiveNumber(plan.canvas.height)) {
    throw new Error('Invalid scene props: plan.canvas must have positive width and height');
  }
  if (!isRecord(plan.camera) || typeof plan.camera.type !== 'string' || !cameraTypes.has(plan.camera.type)) {
    throw new Error('Invalid scene props: plan.camera.type must be one of static, subtle_zoom_in, subtle_zoom_out, subtle_pan');
  }
  if (!Array.isArray(plan.events)) throw new Error('Invalid scene props: plan.events must be an array');
  if (!isRecord(plan.finalHold) || !isPositiveNumber(plan.finalHold.duration)) {
    throw new Error('Invalid scene props: plan.finalHold must have a positive duration');
  }
  return plan as unknown as MotionPlan;
};

const validatePlacement = (placement: unknown): SceneLayerPlacement => {
  if (!isRecord(placement)) throw new Error('Invalid scene props: layer.placement must be an object');
  for (const key of ['x', 'y', 'width', 'height', 'zIndex'] as const) {
    if (typeof placement[key] !== 'number' || !Number.isFinite(placement[key])) {
      throw new Error(`Invalid scene props: layer.placement.${key} must be a finite number`);
    }
  }
  return placement as unknown as SceneLayerPlacement;
};

export const loadSceneProps = (raw: unknown): SceneProps => {
  if (!isRecord(raw)) throw new Error('Invalid scene props: root must be an object');
  const plan = validatePlan(raw.plan);
  if (typeof raw.background !== 'string' || raw.background.length === 0) {
    throw new Error('Invalid scene props: "background" must be a non-empty string');
  }
  if (!Array.isArray(raw.layers)) throw new Error('Invalid scene props: "layers" must be an array');
  const layers = raw.layers.map((layer: unknown, index: number): SceneLayerSpec => {
    if (!isRecord(layer)) throw new Error(`Invalid scene props: layers[${index}] must be an object`);
    if (typeof layer.elementId !== 'string' || layer.elementId.length === 0) {
      throw new Error(`Invalid scene props: layers[${index}].elementId must be a non-empty string`);
    }
    if (typeof layer.asset !== 'string' || layer.asset.length === 0) {
      throw new Error(`Invalid scene props: layers[${index}].asset must be a non-empty string`);
    }
    return {
      elementId: layer.elementId,
      asset: layer.asset,
      placement: validatePlacement(layer.placement),
    };
  });
  return {plan, background: raw.background, layers};
};
