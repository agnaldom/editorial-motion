import type {SceneGraph} from './graph';

// scene-schema roda em Node (API) e no browser (bundle Remotion): env é lido de
// forma segura e os defaults do spec valem quando process não existe.
const env = (): Record<string, string | undefined> =>
  (globalThis as {process?: {env?: Record<string, string | undefined>}}).process?.env ?? {};

// SPEC V2 §13 (issue #143): limiares configuráveis por env com defaults do spec.
export const layerabilityThresholds = (): {layerMin: number; regionMin: number} => ({
  layerMin: Number(env().LAYERABILITY_LAYER_MIN ?? 0.72),
  regionMin: Number(env().LAYERABILITY_REGION_MIN ?? 0.45),
});

export type LayerabilityDecision = 'layer' | 'region' | 'attached';

export const classifyLayerability = (score: number, thresholds = layerabilityThresholds()): LayerabilityDecision => {
  if (score >= thresholds.layerMin) return 'layer';
  if (score >= thresholds.regionMin) return 'region';
  return 'attached';
};

/**
 * Aplica as decisões de layerability no grafo (§13): elemento "attached" não pode
 * ser movido — permanece anexado à composição (o planner o revela, não o desloca).
 * Elemento "region" é candidato a região/grupo, não a layer independente.
 */
export const applyLayerabilityDecisions = (graph: SceneGraph): SceneGraph => ({
  ...graph,
  elements: graph.elements.map((element) => {
    const decision = classifyLayerability(element.layerability);
    if (decision === 'attached' && element.movable) {
      return {...element, movable: false};
    }
    return element;
  }),
});
