import type {MotionPlanV2} from '@editorial-motion/motion-schema';
import type {SceneGraph} from '@editorial-motion/scene-schema';
import {evaluateElementAtFrame} from './evaluateElement';

// SPEC V2 §34–§35 (issue #147): validação obrigatória antes do render. O plano que
// seria "zoom na imagem inteira" falha aqui — MOTION_PLAN_TOO_STATIC e
// source-only detection são o antídoto do V1 ("vídeo efetivamente estático").

export const VALIDATOR_CODES = {
  unknownTarget: 'MOTION_PLAN_INVALID',
  exceedsDuration: 'MOTION_PLAN_INVALID',
  sourceOnly: 'MOTION_PLAN_INVALID',
  tooFewIndependent: 'MOTION_PLAN_INVALID',
  tooStatic: 'MOTION_PLAN_TOO_STATIC',
} as const;

export type PlanIssue = {
  code: string;
  message: string;
};

export type PlanV2Validation = {
  errors: PlanIssue[];
  warnings: PlanIssue[];
  valid: boolean;
  metrics: {
    independentAnimatedElements: number;
    expectedFrameVariance: number;
  };
};

export type ValidatorMode = 'semantic' | 'region' | 'fallback';

export const validatorModeFor = (plan: MotionPlanV2): ValidatorMode =>
  plan.strategy.qualityLevel >= 3 ? 'semantic' : plan.strategy.qualityLevel === 2 ? 'region' : 'fallback';

const SAMPLE_COUNT = 12;
const CHANGE_EPSILON = 1e-4;
const STATIC_VARIANCE_THRESHOLD = 0.15;

type SampledState = ReturnType<typeof evaluateElementAtFrame>;

const stateChanged = (a: SampledState, b: SampledState): boolean =>
  Math.abs(a.translateX - b.translateX) > CHANGE_EPSILON
  || Math.abs(a.translateY - b.translateY) > CHANGE_EPSILON
  || Math.abs(a.scale - b.scale) > CHANGE_EPSILON
  || Math.abs(a.opacity - b.opacity) > CHANGE_EPSILON
  || Math.abs((a.reveal?.progress ?? 1) - (b.reveal?.progress ?? 1)) > CHANGE_EPSILON
  || Math.abs(a.rotationDeg - b.rotationDeg) > CHANGE_EPSILON;

const INDEPENDENT_TYPES = new Set(['subject', 'object', 'region', 'icon', 'node', 'foreground']);

export const validateMotionPlanV2 = (
  plan: MotionPlanV2,
  graph: SceneGraph,
  mode: ValidatorMode = validatorModeFor(plan),
): PlanV2Validation => {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const elements = new Map(graph.elements.map((element) => [element.id, element]));

  // §34 — valid target
  for (const track of plan.tracks) {
    if (!elements.has(track.target)) {
      errors.push({code: VALIDATOR_CODES.unknownTarget, message: `Unknown target: ${track.target}`});
    }
  }

  // §34 — duration: nenhuma animação ultrapassa a timeline
  for (const track of plan.tracks) {
    for (const animation of track.animations) {
      if (animation.endFrame > plan.meta.durationFrames) {
        errors.push({code: VALIDATOR_CODES.exceedsDuration, message: `${track.target}: animation ends at ${animation.endFrame}, past duration ${plan.meta.durationFrames}`});
      }
    }
  }

  // §35 — expected frame variance por amostragem determinística
  const frames = Array.from({length: SAMPLE_COUNT}, (_, index) =>
    Math.round((index / (SAMPLE_COUNT - 1)) * (plan.meta.durationFrames - 1)),
  );
  const samples = plan.tracks.map((track) => frames.map((frame) => evaluateElementAtFrame(track.animations, frame)));
  const changes: boolean[] = [];
  for (let sample = 1; sample < frames.length; sample += 1) {
    changes.push(plan.tracks.some((_, trackIndex) => stateChanged(samples[trackIndex][sample - 1], samples[trackIndex][sample])));
  }
  const expectedFrameVariance = changes.filter(Boolean).length / Math.max(1, changes.length);

  // §34 — independent animated elements (fora do background/plano de fundo)
  const independentAnimated = new Set<string>();
  plan.tracks.forEach((track, trackIndex) => {
    const element = elements.get(track.target);
    if (!element || !INDEPENDENT_TYPES.has(element.visualType)) return;
    if (samples[trackIndex].some((state, index) => index > 0 && stateChanged(samples[trackIndex][index - 1], state))) {
      independentAnimated.add(track.target);
    }
  });

  const animatedBackgroundOnly = plan.tracks.length > 0
    && plan.tracks.every((track) => {
      const element = elements.get(track.target);
      return !element || element.visualType === 'background' || !INDEPENDENT_TYPES.has(element.visualType);
    });

  if (mode === 'semantic') {
    if (independentAnimated.size < 2) {
      errors.push({
        code: VALIDATOR_CODES.tooFewIndependent,
        message: `Semantic mode requires >= 2 independent animated elements (got ${independentAnimated.size})`,
      });
    }
    if (animatedBackgroundOnly) {
      errors.push({code: VALIDATOR_CODES.sourceOnly, message: 'All animations target the source/background image (whole-image-only motion)'});
    }
  } else if (animatedBackgroundOnly) {
    warnings.push({code: VALIDATOR_CODES.sourceOnly, message: 'Whole-image-only motion in non-semantic mode'});
  }

  if (expectedFrameVariance < STATIC_VARIANCE_THRESHOLD) {
    errors.push({
      code: VALIDATOR_CODES.tooStatic,
      message: `Expected frame variance ${expectedFrameVariance.toFixed(3)} below threshold ${STATIC_VARIANCE_THRESHOLD} — refusing to render a static video`,
    });
  }

  // §49 — presets: rotação além de 3° é advertida (engine trava translate em 8%)
  for (const track of plan.tracks) {
    for (const animation of track.animations) {
      if (animation.type === 'rotate' && Math.abs(animation.to - animation.from) > 3) {
        warnings.push({code: 'MOTION_PLAN_INVALID', message: `${track.target}: rotation ${Math.abs(animation.to - animation.from).toFixed(1)}° exceeds the 3° editorial preset`});
      }
    }
  }

  return {
    errors,
    warnings,
    valid: errors.length === 0,
    metrics: {
      independentAnimatedElements: independentAnimated.size,
      expectedFrameVariance: Number(expectedFrameVariance.toFixed(3)),
    },
  };
};
