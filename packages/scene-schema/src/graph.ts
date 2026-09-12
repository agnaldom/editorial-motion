import {z} from 'zod';
import {normalizedRectSchema} from './base';
import type {SceneAnalysis} from './index';

// SPEC V2 §10 — classificação multi-rótulo com confiança (o V1 usava enum único).
export const sceneTypeV2Schema = z.enum([
  'photo', 'portrait', 'landscape', 'map', 'diagram', 'infographic',
  'editorial-collage', 'illustration', 'document', 'screenshot',
  'architecture', 'product', 'data-visualization', 'abstract', 'mixed',
]);
export type SceneTypeV2 = z.infer<typeof sceneTypeV2Schema>;

export const sceneClassificationSchema = z.object({
  type: sceneTypeV2Schema,
  confidence: z.number().finite().min(0).max(1),
}).strict();

// SPEC V2 §12 — modelo de elemento semântico (visualType ≠ tipo v1: descreve O QUE é,
// semanticRole descreve o papel na narrativa).
export const sceneElementVisualTypeSchema = z.enum([
  'subject', 'object', 'region', 'background', 'foreground', 'text',
  'icon', 'line', 'node', 'connector', 'decoration', 'unknown',
]);

export const sceneElementSemanticRoleSchema = z.enum([
  'primary', 'secondary', 'supporting', 'connector', 'annotation', 'background',
]);

// SPEC V2 §19 — estratégia de texto por elemento.
export const textStrategySchema = z.enum(['keep_with_parent', 'keep_static', 'replace_with_real_text']);

export const sceneGraphElementSchema = z.object({
  id: z.string().min(1),
  visualType: sceneElementVisualTypeSchema,
  semanticRole: sceneElementSemanticRoleSchema,
  bbox: normalizedRectSchema,
  confidence: z.number().finite().min(0).max(1),
  saliency: z.number().finite().min(0).max(1).default(0),
  layerability: z.number().finite().min(0).max(1).default(0),
  movable: z.boolean(),
  preserveShape: z.boolean().default(false),
  parentId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  zIndex: z.number().int().finite(),
  textStrategy: textStrategySchema.optional(),
  backgroundRecoverability: z.number().finite().min(0).max(1).optional(),
  maskPath: z.string().min(1).optional(),
  assetPath: z.string().min(1).optional(),
}).strict();

export const sceneRelationshipSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(['connected', 'contains', 'attached', 'grouped', 'annotates']),
}).strict();

// SPEC V2 §14 — elementos que se movem juntos (pessoa = grupo único, §39).
export const motionGroupSchema = z.object({
  id: z.string().min(1),
  members: z.array(z.string().min(1)).min(1),
  anchor: z.enum(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).default('center'),
}).strict();

export const sceneGraphSchema = z.object({
  version: z.literal('2'),
  sceneId: z.string().min(1),
  canvas: z.object({width: z.number().int().positive(), height: z.number().int().positive()}).strict(),
  classifications: z.array(sceneClassificationSchema).min(1),
  background: z.string().min(1).optional(),
  elements: z.array(sceneGraphElementSchema).min(1).max(50),
  relationships: z.array(sceneRelationshipSchema).default([]),
  motionGroups: z.array(motionGroupSchema).default([]),
  analysis: z.object({
    primarySubjectIds: z.array(z.string().min(1)).default([]),
    visualCenter: z.object({x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1)}),
    hasDepth: z.boolean(),
    hasEmbeddedText: z.boolean(),
    hasGraphicConnections: z.boolean(),
    complexity: z.number().finite().min(0).max(1),
  }).strict(),
}).strict();

export type SceneGraphElement = z.infer<typeof sceneGraphElementSchema>;
export type SceneRelationship = z.infer<typeof sceneRelationshipSchema>;
export type MotionGroup = z.infer<typeof motionGroupSchema>;
export type SceneGraph = z.infer<typeof sceneGraphSchema>;

export type SceneGraphValidation = {
  errors: string[];
  valid: boolean;
};

// Validações cruzadas do §60 — o que o Zod não alcança sozinho.
export const validateSceneGraph = (graph: SceneGraph): SceneGraphValidation => {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const element of graph.elements) {
    if (ids.has(element.id)) errors.push(`Duplicate element id: ${element.id}`);
    ids.add(element.id);
  }
  const has = (id: string): boolean => ids.has(id);
  for (const element of graph.elements) {
    if (element.parentId && !has(element.parentId)) errors.push(`Unknown parentId ${element.parentId} on ${element.id}`);
    if (element.groupId && !graph.motionGroups.some((group) => group.id === element.groupId)) {
      errors.push(`Unknown groupId ${element.groupId} on ${element.id}`);
    }
  }
  for (const relationship of graph.relationships) {
    if (!has(relationship.source)) errors.push(`Relationship source not found: ${relationship.source}`);
    if (!has(relationship.target)) errors.push(`Relationship target not found: ${relationship.target}`);
    if (relationship.source === relationship.target) errors.push(`Self relationship: ${relationship.source}`);
  }
  for (const group of graph.motionGroups) {
    for (const member of group.members) {
      if (!has(member)) errors.push(`Motion group ${group.id} references unknown member: ${member}`);
    }
  }
  if (graph.background && !has(graph.background)) errors.push(`Background element not found: ${graph.background}`);
  for (const id of graph.analysis.primarySubjectIds) {
    if (!has(id)) errors.push(`Primary subject not found: ${id}`);
  }
  return {errors, valid: errors.length === 0};
};

// Conversão v1 → v2: o pipeline atual (heurística/LLM) produz SceneAnalysis; o grafo é
// a representação canônica do V2, então todo consumidor v1 tem caminho de migração.
const visualTypeByV1: Record<string, SceneGraphElement['visualType']> = {
  cutout: 'object',
  map_region: 'region',
  route: 'connector',
  arrow: 'connector',
  icon: 'icon',
  photo: 'subject',
  document: 'object',
  chart: 'object',
  text: 'text',
  stat_box: 'text',
  background: 'background',
  decorative: 'decoration',
};

const semanticRoleByV1: Record<string, SceneGraphElement['semanticRole']> = {
  primary: 'primary',
  secondary: 'secondary',
  connector: 'connector',
  static: 'annotation',
  protected: 'annotation',
};

export const sceneAnalysisToSceneGraph = (analysis: SceneAnalysis): SceneGraph => {
  const isTextLike = (type: string): boolean => type === 'text' || type === 'stat_box';
  const elements: SceneGraphElement[] = analysis.elements.map((element) => ({
    id: element.id,
    visualType: visualTypeByV1[element.type] ?? 'unknown',
    semanticRole: semanticRoleByV1[element.motionRole] ?? 'supporting',
    bbox: element.bbox,
    confidence: element.confidence,
    saliency: element.motionRole === 'primary' ? 0.9 : element.motionRole === 'secondary' ? 0.6 : 0.3,
    layerability: element.layerability ?? 0,
    movable: element.animatable && !element.protected,
    preserveShape: element.protected || isTextLike(element.type),
    zIndex: element.zIndex,
    ...(isTextLike(element.type)
      ? {textStrategy: (element.protected ? 'keep_static' : 'keep_with_parent') as 'keep_static' | 'keep_with_parent'}
      : {}),
  }));
  // Regiões protegidas viram elementos de anotação (§19/§38: texto/estatística nunca deforma).
  for (const region of analysis.protectedRegions) {
    if (elements.some((element) => element.id === region.id)) continue;
    elements.push({
      id: region.id,
      visualType: 'region',
      semanticRole: 'annotation',
      bbox: region.bbox,
      confidence: 1,
      saliency: 0.5,
      layerability: 0,
      movable: false,
      preserveShape: true,
      zIndex: 999,
      textStrategy: 'keep_static',
    });
  }
  const primaries = elements.filter((element) => element.semanticRole === 'primary' && element.movable);
  const center = primaries.length > 0
    ? {
      x: primaries.reduce((sum, element) => sum + element.bbox.x + element.bbox.width / 2, 0) / primaries.length,
      y: primaries.reduce((sum, element) => sum + element.bbox.y + element.bbox.height / 2, 0) / primaries.length,
    }
    : {x: 0.5, y: 0.5};
  const classifications: Array<{type: SceneTypeV2; confidence: number}> = (analysis.classifications ?? [])
    .map((item) => ({type: item.type, confidence: item.confidence}))
    .filter((item) => sceneTypeV2Schema.safeParse(item.type).success)
    .map((item) => ({type: item.type as SceneTypeV2, confidence: item.confidence}))
    .slice(0, 3);
  const graph: SceneGraph = {
    version: '2',
    sceneId: analysis.sceneId,
    canvas: {width: analysis.source.width, height: analysis.source.height},
    classifications: classifications.length > 0
      ? classifications
      : [{
        type: sceneTypeV2Schema.safeParse(analysis.compositionType).success
          ? analysis.compositionType as SceneTypeV2
          : 'mixed' as SceneTypeV2,
        confidence: 1,
      }],
    background: elements.find((element) => element.visualType === 'background')?.id,
    elements,
    relationships: [],
    motionGroups: [],
    analysis: {
      primarySubjectIds: primaries.map((element) => element.id),
      visualCenter: {x: Math.min(1, Math.max(0, center.x)), y: Math.min(1, Math.max(0, center.y))},
      hasDepth: false,
      hasEmbeddedText: elements.some((element) => element.visualType === 'text'),
      hasGraphicConnections: elements.some((element) => element.visualType === 'connector'),
      complexity: Math.min(1, elements.length / 10),
    },
  };
  return sceneGraphSchema.parse(graph);
};
