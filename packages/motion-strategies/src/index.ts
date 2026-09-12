import {classifyLayerability, type SceneGraph, type SceneTypeV2} from '@editorial-motion/scene-schema';

// SPEC V2 §20–§22, §46 (issue #144): strategy ≠ effect. A strategy compõe primitivos
// e é selecionada por classificação + capacidades + layerability + intent + safety —
// nunca LLM → transforms diretos.

export const STRATEGY_NAMES = [
  'disassemble-reassemble',
  'layered-parallax',
  'subject-reveal',
  'network-flow',
  'diagram-build',
  'infographic-build',
  'editorial-collage',
  'focus-region',
  'screenshot-focus',
  'safe-fallback',
] as const;

export type StrategyName = (typeof STRATEGY_NAMES)[number];

export type PromptIntent = {
  intent?: string;
  preferredMotion?: string[];
  avoid?: string[];
};

export type StrategyCandidate = {
  name: StrategyName;
  score: number;
};

export type StrategySelection = {
  candidateStrategies: StrategyCandidate[];
  selected: StrategyName;
};

// Tags para modular pelo intent do prompt (§45): "layered" boosta estratégias em
// camadas, "progressive" as sequenciais, "restrained" as discretas.
const TAGS: Record<StrategyName, string[]> = {
  'disassemble-reassemble': ['layered', 'progressive', 'structural'],
  'layered-parallax': ['layered', 'restrained'],
  'subject-reveal': ['layered', 'restrained', 'progressive'],
  'network-flow': ['progressive', 'structural'],
  'diagram-build': ['progressive', 'structural'],
  'infographic-build': ['progressive', 'structural'],
  'editorial-collage': ['layered', 'progressive', 'structural'],
  'focus-region': ['restrained'],
  'screenshot-focus': ['restrained', 'progressive'],
  'safe-fallback': ['restrained'],
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

type SceneCapabilities = {
  layerCount: number;
  regionCount: number;
  connectorCount: number;
  nodeCount: number;
  textCount: number;
  topType: SceneTypeV2;
  topConfidence: number;
};

const capabilitiesOf = (graph: SceneGraph): SceneCapabilities => {
  const decisions = graph.elements.map((element) => classifyLayerability(element.layerability));
  const top = graph.classifications[0];
  return {
    layerCount: decisions.filter((decision, index) => decision === 'layer' && graph.elements[index].movable).length,
    regionCount: decisions.filter((decision) => decision === 'region').length,
    connectorCount: graph.elements.filter((element) => element.visualType === 'connector').length,
    nodeCount: graph.elements.filter((element) => element.visualType === 'node' || element.visualType === 'icon').length,
    textCount: graph.elements.filter((element) => element.visualType === 'text').length,
    topType: top.type,
    topConfidence: top.confidence,
  };
};

const typeBoost = (caps: SceneCapabilities, types: SceneTypeV2[]): number =>
  types.includes(caps.topType) ? caps.topConfidence : 0;

const SCORERS: Record<StrategyName, (caps: SceneCapabilities) => number> = {
  'disassemble-reassemble': (caps) => {
    if (caps.layerCount < 2) return 0.1;
    const layers = clamp01(caps.layerCount / 3);
    return clamp01(0.55 * layers + 0.25 * typeBoost(caps, ['editorial-collage', 'map', 'photo']) + 0.2 * (caps.regionCount > 0 ? 1 : 0));
  },
  'network-flow': (caps) => {
    if (caps.connectorCount < 1 || caps.nodeCount + caps.layerCount < 2) return 0.1;
    return clamp01(0.5 * clamp01(caps.connectorCount / 3) + 0.3 * typeBoost(caps, ['map', 'diagram']) + 0.2 * clamp01(caps.nodeCount / 4));
  },
  'diagram-build': (caps) => {
    if (caps.nodeCount < 2) return 0.1;
    return clamp01(0.4 * typeBoost(caps, ['diagram', 'data-visualization']) + 0.3 * clamp01(caps.nodeCount / 4) + 0.3 * clamp01(caps.connectorCount / 2));
  },
  'infographic-build': (caps) => clamp01(
    0.45 * typeBoost(caps, ['infographic', 'document', 'data-visualization'])
    + 0.25 * clamp01(caps.textCount / 3)
    + 0.3 * clamp01((caps.layerCount + caps.regionCount) / 5),
  ),
  'editorial-collage': (caps) => clamp01(
    0.5 * typeBoost(caps, ['editorial-collage'])
    + 0.5 * clamp01(caps.layerCount / 6),
  ),
  'layered-parallax': (caps) => {
    if (caps.layerCount < 1 || caps.layerCount > 3) return 0.15;
    return clamp01(0.5 * typeBoost(caps, ['photo', 'portrait', 'landscape', 'architecture']) + 0.4 * clamp01(caps.layerCount / 2));
  },
  'subject-reveal': (caps) => {
    if (caps.layerCount < 1) return 0.1;
    return clamp01(0.55 * typeBoost(caps, ['portrait', 'photo', 'product']) + 0.45 * clamp01(caps.layerCount / 2));
  },
  'focus-region': (caps) => clamp01(
    0.5 * typeBoost(caps, ['document', 'architecture', 'product', 'screenshot'])
    + 0.5 * clamp01(caps.regionCount / 3),
  ),
  'screenshot-focus': (caps) => clamp01(
    0.7 * typeBoost(caps, ['screenshot'])
    + 0.3 * clamp01(caps.regionCount / 2),
  ),
  // §58: fallback seguro sempre disponível — nunca zera, vira selected quando nada
  // melhor alcança o mínimo.
  'safe-fallback': () => 0.3,
};

const SELECT_MIN_SCORE = 0.35;

export const scoreStrategies = (graph: SceneGraph, intent?: PromptIntent): StrategySelection => {
  const caps = capabilitiesOf(graph);
  const preferred = new Set(intent?.preferredMotion ?? []);
  const candidates: StrategyCandidate[] = STRATEGY_NAMES.map((name) => {
    let score = SCORERS[name](caps);
    const boost = TAGS[name].filter((tag) => preferred.has(tag)).length;
    score = clamp01(score + 0.05 * boost);
    return {name, score: Number(score.toFixed(3))};
  }).sort((a, b) => b.score - a.score);

  const best = candidates.find((candidate) => candidate.name !== 'safe-fallback');
  const selected: StrategyName = !best || best.score < SELECT_MIN_SCORE ? 'safe-fallback' : best.name;
  return {candidateStrategies: candidates, selected};
};
