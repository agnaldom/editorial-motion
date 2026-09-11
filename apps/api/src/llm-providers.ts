import {fileTypeFromBuffer} from 'file-type';
import type {MotionPlannerInput, MotionPlannerProvider} from './motion-planner';
import type {SemanticVisionProvider} from './scene-analyzer';
import {DeterministicMotionPlanner, DeterministicSceneAnalyzer} from './doubles';
import {chatCompletion, extractJson, type ChatOptions} from './llm';
import {gestureNotesForPrompt} from './motion-vocabulary';

const PLANNER_SYSTEM = `You are an editorial documentary motion planner.

Convert the user's motion instruction and a structured SceneAnalysis of a still
image into a deterministic MotionPlan JSON document. The visual language is
modern documentary explainer / editorial visual journalism: restrained, clean,
hierarchical, informative.

Motion types and their params:
- Entrances: fade_in; scale_in; drop (params.distanceRatio 0.05-0.15, params.fade);
  slide_up/slide_down/slide_left/slide_right (params.distanceRatio);
  assemble (sequential build-up — stagger the start values per element).
- Reveals: wipe_reveal (params.direction left|right|up|down);
  mask_reveal (circular reveal from the center);
  draw_path/draw_arrow (only route/arrow elements, easing linear, persist true).
- Emphasis overlays: highlight, circle_emphasis, underline (persist true).
- Displacement: shift (params.dxRatio/dyRatio in canvas ratio, keep small);
  separate_layers (params.direction, params.distanceRatio <= 0.1).
- hold (timeline reservation). freeze/lock/persist cues mean persist true on the
  target events so the final state is kept.

Rules:
- Default to a static camera.
- Use only target IDs supplied in SceneAnalysis.
- Never invent image elements; never generate or rewrite typography.
- Never animate protected regions unless explicitly permitted.
- Preserve each element's original final position.
- Favor sequential reveals over simultaneous motion; prefer 0.5-1.0s entrances.
- Use linear path drawing for routes and arrows.
- No bounce, spin, 3D flips, glow bursts, camera shake, or flashy effects.
- Reserve at least 1.5s for a final hold; every event must finish within durationSeconds.
- If the user says lock/freeze/persist, the element remains in its final state (persist: true).
- Output JSON only.`;

const PLANNER_RULES = [
  'Use only available targetId values.',
  'Do not animate protected elements.',
  'Preserve original landing coordinates.',
  'Default to a static camera.',
  'Favor sequential entrances.',
  'Never animate every element at once without explicit reason.',
  'No heavy bounce, overshoot, 3D, or random decorative effects.',
  'Prefer a final hold of at least 1.5 seconds.',
  'If the prompt says lock/freeze/persist, set persist=true.',
  'Return strict JSON only.',
];

const buildPlannerRequest = (input: MotionPlannerInput, previous: unknown, errors: string[]): string => {
  const gestureHints = gestureNotesForPrompt(input.prompt);
  return JSON.stringify({
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    stylePreset: 'editorial-documentary',
    sceneAnalysis: input.sceneAnalysis,
    allowedMotionTypes: input.allowedMotionTypes,
    rules: PLANNER_RULES,
    ...(previous !== undefined ? {previousAttempt: previous, validationErrors: errors} : {}),
    ...(gestureHints.length > 0 ? {gestureHints} : {}),
  });
};

export class OmniRouteMotionPlanner implements MotionPlannerProvider {
  constructor(
    private readonly model = process.env.MOTION_LLM_MODEL ?? 'auto/coding',
    private readonly options: ChatOptions = {},
  ) {}

  async plan(input: MotionPlannerInput): Promise<unknown> {
    return this.generate(input, undefined, []);
  }

  async repair(input: MotionPlannerInput, previousOutput: unknown, errors: string[]): Promise<unknown> {
    return this.generate(input, previousOutput, errors);
  }

  private async generate(input: MotionPlannerInput, previous: unknown, errors: string[]): Promise<unknown> {
    const content = await chatCompletion(this.model, [
      {role: 'system', content: PLANNER_SYSTEM},
      {role: 'user', content: buildPlannerRequest(input, previous, errors)},
    ], {json: true, ...this.options});
    return extractJson(content);
  }
}

const ANALYZER_SYSTEM = `You analyze a still image for an editorial documentary animation pipeline.
Identify the major visual objects, their visual hierarchy and z-order, which
should remain static or protected (text, statistics, logos, titles), and which
are animatable. Return strict JSON only, matching the requested shape exactly.
Never invent or rewrite text.`;

export class OmniRouteSceneAnalyzer implements SemanticVisionProvider {
  constructor(
    private readonly model = process.env.MOTION_VISION_MODEL ?? process.env.MOTION_LLM_MODEL ?? 'auto/coding',
    private readonly options: ChatOptions = {},
  ) {}

  async analyze({image, prompt}: {image: Buffer; prompt: string}): Promise<unknown> {
    const detected = await fileTypeFromBuffer(image);
    const mime = detected?.mime ?? 'image/png';
    const content = await chatCompletion(this.model, [
      {role: 'system', content: ANALYZER_SYSTEM},
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Motion prompt: ${prompt}`,
              'Return a SceneAnalysis JSON object: version "1", sceneId "scene01",',
              'source {width, height, aspectRatio}, compositionType (editorial-collage | map | diagram | infographic | photo | mixed),',
              'elements (1-10 items, each: id, label, type (cutout | map_region | route | arrow | icon | photo | document | chart | text | stat_box | background | decorative),',
              'bbox {x, y, width, height} normalized 0..1, confidence 0..1, zIndex integer, animatable boolean, protected boolean,',
              'motionRole (primary | secondary | connector | static | protected), source (vision | detector | derived)),',
              'protectedRegions ([] of {id, label, bbox, reason}).',
              'Mark text, statistic, and logo regions as protected. Use the real pixel dimensions of this image for source.',
            ].join('\n'),
          },
          {type: 'image_url', image_url: {url: `data:${mime};base64,${image.toString('base64')}`}},
        ],
      },
    ], {json: true, ...this.options});
    return extractJson(content);
  }
}

export const createSceneAnalyzer = (): SemanticVisionProvider =>
  process.env.MOTION_VISION_MODEL || process.env.MOTION_LLM_MODEL
    ? new OmniRouteSceneAnalyzer()
    : new DeterministicSceneAnalyzer();

export const createMotionPlanner = (): MotionPlannerProvider =>
  process.env.MOTION_LLM_MODEL ? new OmniRouteMotionPlanner() : new DeterministicMotionPlanner();

