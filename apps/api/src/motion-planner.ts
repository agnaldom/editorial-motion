import {motionPlanSchema, type MotionPlan} from '@editorial-motion/motion-schema';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import {sceneAnalysisSchema, type SceneAnalysis} from '@editorial-motion/scene-schema';

export type MotionPlannerInput = {
  prompt: string;
  durationSeconds: number;
  fps: number;
  sceneAnalysis: SceneAnalysis;
  allowedMotionTypes: string[];
};

export interface MotionPlannerProvider {
  plan(input: MotionPlannerInput): Promise<unknown>;
  repair?(input: MotionPlannerInput, previousOutput: unknown, errors: string[]): Promise<unknown>;
}

export class MotionPlanError extends Error {
  readonly code = 'MOTION_PLAN_FAILED';
}

export const createMotionPlan = async (
  provider: MotionPlannerProvider,
  input: MotionPlannerInput,
  maxAttempts = 3,
): Promise<MotionPlan> => {
  const scene = sceneAnalysisSchema.parse(input.sceneAnalysis);
  let output: unknown = await provider.plan({...input, sceneAnalysis: scene});
  let errors: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const parsed = motionPlanSchema.safeParse(output);
    if (parsed.success) {
      const validation = validateMotionPlan(parsed.data, scene);
      if (validation.valid) return parsed.data;
      errors = validation.errors;
    } else {
      errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    }
    if (!provider.repair || attempt === maxAttempts - 1) break;
    output = await provider.repair(input, output, errors);
  }

  throw new MotionPlanError(`Motion planner returned an invalid plan: ${errors.join('; ')}`);
};

export class DevelopmentMotionPlanner implements MotionPlannerProvider {
  async plan(): Promise<unknown> {
    throw new MotionPlanError('No motion planner provider is configured');
  }
}
