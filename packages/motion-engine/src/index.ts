import type {MotionEvent} from '@editorial-motion/motion-schema';
import type {MotionPlan} from '@editorial-motion/motion-schema';
import type {SceneAnalysis} from '@editorial-motion/scene-schema';

export type LayerClip = {
  kind: 'wipe' | 'mask';
  direction: string;
};

export type LayerRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  progress: number;
  direction: string;
};

export type LayerState = {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  revealProgress: number;
  clip: LayerClip | null;
  // §5.4 (issue #126): janelas de region_reveal; quando presentes, o renderer
  // exibe a layer apenas dentro dessas regiões (máscara SVG acumulativa).
  regions: LayerRegion[] | null;
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

const directionOffsets: Record<string, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const directionOffset = (direction: unknown): readonly [number, number] =>
  directionOffsets[typeof direction === 'string' ? direction : ''] ?? directionOffsets.down;

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
    clip: initial.clip ?? null,
    regions: initial.regions ?? null,
  };
  let time = frame / fps;

  // freeze (§5.4, issue #126): a partir do start, o tempo da layer congela —
  // o estado passa a ser calculado como se o relógio parasse naquele instante.
  const frozenAt = events
    .filter((event) => event.type === 'freeze' && event.start <= time)
    .reduce((earliest: number | null, event) => (earliest === null || event.start < earliest ? event.start : earliest), null);
  if (frozenAt !== null) time = frozenAt;

  // region_reveal: há janelas → a layer só existe dentro delas (progresso por evento).
  const regionEvents = events.filter((event) => event.type === 'region_reveal');
  if (regionEvents.length > 0) {
    state.regions = regionEvents.map((event) => {
      const rect = (event.params ?? {}).region as {x?: unknown; y?: unknown; width?: unknown; height?: unknown} | undefined;
      const active = activeOrPersisted(time, event);
      const progress = active ? eventProgress(time, event) : 0;
      return {
        x: typeof rect?.x === 'number' ? rect.x : 0,
        y: typeof rect?.y === 'number' ? rect.y : 0,
        width: typeof rect?.width === 'number' ? rect.width : 1,
        height: typeof rect?.height === 'number' ? rect.height : 1,
        progress: event.persist === false && time > event.start + event.duration ? 0 : progress,
        direction: typeof (event.params ?? {}).direction === 'string' ? ((event.params as {direction: string}).direction) : 'left',
      };
    });
  }

  for (const event of events) {
    if (time < event.start) {
      const params = event.params ?? {};
      const distance = typeof params.distanceRatio === 'number' ? params.distanceRatio : 0.08;
      if (event.type === 'fade_in') state.opacity = 0;
      if (event.type === 'scale_in') state.scale = 0;
      if (event.type === 'assemble') { state.opacity = 0; state.scale = 0.9; }
      if (event.type === 'drop') {
        state.translateY = -distance;
        if (params.fade === true) state.opacity = 0;
      }
      if (event.type === 'slide_up') state.translateY = distance;
      if (event.type === 'slide_down') state.translateY = -distance;
      if (event.type === 'slide_left') state.translateX = distance;
      if (event.type === 'slide_right') state.translateX = -distance;
      if (event.type === 'wipe_reveal' || event.type === 'mask_reveal'
        || event.type === 'draw_path' || event.type === 'draw_arrow'
        || event.type === 'step_reveal') state.revealProgress = 0;
      if (event.type === 'unstack') {
        const order = Math.max(0, Math.floor(typeof params.order === 'number' ? params.order : 0));
        const spread = typeof params.spreadRatio === 'number' ? params.spreadRatio : 0.05;
        state.translateX = order * spread;
        state.translateY = -order * spread;
        if (params.fade === true) state.opacity = 0;
      }
      continue;
    }
    if (!activeOrPersisted(time, event)) continue;
    const progress = eventProgress(time, event);
    const params = event.params ?? {};
    const distance = typeof params.distanceRatio === 'number' ? params.distanceRatio : 0.08;

    switch (event.type) {
      case 'fade_in': state.opacity = progress; break;
      case 'scale_in': state.scale = progress; break;
      case 'drop': state.translateY = progress >= 1 ? 0 : (1 - progress) * -distance; state.opacity = params.fade === true ? progress : state.opacity; break;
      case 'slide_up': state.translateY = (1 - progress) * distance; break;
      case 'slide_down': state.translateY = (1 - progress) * -distance; break;
      case 'slide_left': state.translateX = (1 - progress) * distance; break;
      case 'slide_right': state.translateX = (1 - progress) * -distance; break;
      case 'assemble': state.opacity = progress; state.scale = 0.9 + 0.1 * progress; break;
      case 'shift': {
        const dx = typeof params.dxRatio === 'number' ? params.dxRatio : 0;
        const dy = typeof params.dyRatio === 'number' ? params.dyRatio : 0;
        state.translateX = progress * dx;
        state.translateY = progress * dy;
        break;
      }
      case 'separate_layers': {
        const direction = directionOffset(params.direction);
        state.translateX = progress * direction[0] * distance;
        state.translateY = progress * direction[1] * distance;
        break;
      }
      case 'wipe_reveal':
        state.revealProgress = progress;
        state.clip = {kind: 'wipe', direction: typeof params.direction === 'string' ? params.direction : 'left'};
        break;
      case 'mask_reveal':
        state.revealProgress = progress;
        state.clip = {kind: 'mask', direction: 'center'};
        break;
      case 'draw_path':
      case 'draw_arrow':
        // preserva o visual legado (máscara de rota da esquerda para a direita)
        state.revealProgress = progress;
        state.clip = {kind: 'wipe', direction: 'left'};
        break;
      case 'step_reveal': {
        // revelação em etapas: progresso quantizado em `steps` degraus
        const steps = Math.max(2, Math.floor(typeof params.steps === 'number' ? params.steps : 3));
        const quantized = Math.floor(progress * steps) / steps;
        state.revealProgress = progress >= 1 ? 1 : quantized;
        state.clip = {kind: 'wipe', direction: typeof params.direction === 'string' ? params.direction : 'left'};
        break;
      }
      case 'stack': {
        // saída ordenada: a layer desliza para a pilha (diagonal) conforme order
        const order = Math.max(0, Math.floor(typeof params.order === 'number' ? params.order : 0));
        const spread = typeof params.spreadRatio === 'number' ? params.spreadRatio : 0.05;
        state.translateX = progress * order * spread;
        state.translateY = -progress * order * spread;
        if (params.fade === true) state.opacity = 1 - progress;
        break;
      }
      case 'unstack': {
        // entrada ordenada: a layer sai da pilha e assenta no repouso
        const order = Math.max(0, Math.floor(typeof params.order === 'number' ? params.order : 0));
        const spread = typeof params.spreadRatio === 'number' ? params.spreadRatio : 0.05;
        state.translateX = (1 - progress) * order * spread;
        state.translateY = -(1 - progress) * order * spread;
        if (params.fade === true) state.opacity = progress;
        break;
      }
      // region_reveal já foi processado antes do loop (acumula janelas);
      // connect é overlay cross-layer desenhado pelo renderer;
      // freeze congela o tempo acima. Nenhum altera o estado aqui.
      case 'region_reveal':
      case 'connect':
      case 'freeze': break;
      // highlight/circle_emphasis/underline são desenhados pelo GeneratedOverlay do renderer;
      // hold apenas ocupa a timeline. Nenhum afeta o estado da layer.
      case 'highlight':
      case 'circle_emphasis':
      case 'underline':
      case 'hold': break;
      default: break;
    }
  }

  return state;
};

const unitRect = (value: unknown): value is {x: number; y: number; width: number; height: number} =>
  typeof value === 'object' && value !== null
  && typeof (value as {x?: unknown}).x === 'number' && (value as {x: number}).x >= 0 && (value as {x: number}).x <= 1
  && typeof (value as {y?: unknown}).y === 'number' && (value as {y: number}).y >= 0 && (value as {y: number}).y <= 1
  && typeof (value as {width?: unknown}).width === 'number' && (value as {width: number}).width > 0 && (value as {width: number}).width <= 1
  && typeof (value as {height?: unknown}).height === 'number' && (value as {height: number}).height > 0 && (value as {height: number}).height <= 1
  && (value as {x: number; width: number}).x + (value as {width: number}).width <= 1
  && (value as {y: number; height: number}).y + (value as {height: number}).height <= 1;

// Validação determinística de params dos tipos §5.4 (issue #126).
const validateEventParams = (
  event: MotionEvent,
  elements: Map<string, SceneAnalysis['elements'][number]>,
): string[] => {
  const params = event.params ?? {};
  const errors: string[] = [];
  if (event.type === 'region_reveal') {
    if (!unitRect(params.region)) errors.push(`region_reveal requires params.region {{x, y, width, height}} in 0..1: ${event.id}`);
  }
  if (event.type === 'step_reveal') {
    const steps = params.steps;
    if (steps !== undefined && (!Number.isInteger(steps) || (steps as number) < 2)) {
      errors.push(`step_reveal params.steps must be an integer >= 2: ${event.id}`);
    }
  }
  if (event.type === 'connect') {
    if (typeof params.to !== 'string' || params.to.length === 0) {
      errors.push(`connect requires params.to (target element id): ${event.id}`);
    } else if (!elements.has(params.to)) {
      errors.push(`connect params.to references unknown element: ${params.to}`);
    } else if (params.to === event.targetId) {
      errors.push(`connect params.to must differ from targetId: ${event.id}`);
    }
  }
  if (event.type === 'stack' || event.type === 'unstack') {
    const order = params.order;
    if (order !== undefined && (!Number.isInteger(order) || (order as number) < 0)) {
      errors.push(`${event.type} params.order must be an integer >= 0: ${event.id}`);
    }
    if (params.spreadRatio !== undefined && (typeof params.spreadRatio !== 'number' || (params.spreadRatio as number) <= 0)) {
      errors.push(`${event.type} params.spreadRatio must be a positive number: ${event.id}`);
    }
  }
  return errors;
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
    if (protectedIds.has(event.targetId)) errors.push(`Protected target cannot be animated: ${event.targetId}`);
    else if (!elements.has(event.targetId)) errors.push(`Unknown targetId: ${event.targetId}`);
    if (event.start + event.duration > plan.durationSeconds) {
      errors.push(`Event exceeds duration: ${event.id}`);
    }
    errors.push(...validateEventParams(event, elements));
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

export * from './v2';
