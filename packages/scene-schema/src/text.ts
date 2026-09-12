import type {SceneGraph, SceneGraphElement} from './graph';

// SPEC V2 §19, §38–§39 (issue #151): texto e humanos.
//
// - Texto pertencente a um objeto fica anexado (KEEP_WITH_PARENT); texto isolado
//   (faixa de label) fica estático (KEEP_STATIC). Nunca sintetizar texto.
// - preserveShape: texto e anotações nunca deformam; validador v2 rejeita
//   rotate/scale agressivo neles.
// - Humano = grupo único de motion (sem segmentar partes do corpo): subject com
//   anexos vira motion group.

const overlapRatio = (a: SceneGraphElement['bbox'], b: SceneGraphElement['bbox']): number => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  return intersection / Math.min(a.width * a.height, b.width * b.height);
};

/** Anexa elementos de texto ao elemento visual ao qual pertencem (§19). */
export const attachTextElements = (graph: SceneGraph): SceneGraph => {
  const elements = graph.elements.map((element) => ({...element}));
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const text of elements.filter((element) => element.visualType === 'text')) {
    if (text.parentId) continue;
    const host = elements
      .filter((element) => element.visualType !== 'text' && element.id !== text.id)
      .sort((a, b) => overlapRatio(b.bbox, text.bbox) - overlapRatio(a.bbox, text.bbox))[0];
    if (host && overlapRatio(host.bbox, text.bbox) > 0.05) {
      text.parentId = host.id;
      text.textStrategy = 'keep_with_parent';
      text.movable = false;
    } else if (text.textStrategy !== 'keep_static') {
      text.textStrategy = 'keep_static';
      text.movable = false;
    }
  }
  return {...graph, elements: elements.map((element) => byId.get(element.id) ?? element)};
};

/** Defaults de preserveShape (§38): texto e anotações não deformam nunca. */
export const applyShapePreservation = (graph: SceneGraph): SceneGraph => ({
  ...graph,
  elements: graph.elements.map((element) =>
    (element.visualType === 'text' || element.semanticRole === 'annotation') && !element.preserveShape
      ? {...element, preserveShape: true}
      : element,
  ),
});

/**
 * §39 — humano (subject) = motion group único: o subject e tudo que está anexado a
 * ele se movem juntos; o planner nunca separa partes.
 */
export const buildMotionGroups = (graph: SceneGraph): SceneGraph => {
  const groups = graph.elements
    .filter((element) => element.visualType === 'subject' || (element.parentId === undefined && element.semanticRole === 'primary'))
    .map((subject) => ({
      id: `mg-${subject.id}`,
      members: [subject.id, ...graph.elements.filter((element) => element.parentId === subject.id).map((element) => element.id)],
      anchor: 'center' as const,
    }))
    .filter((group) => group.members.length > 0);
  if (groups.length === 0) return graph;
  const memberOf = new Map(groups.flatMap((group) => group.members.map((member) => [member, group.id])));
  return {
    ...graph,
    motionGroups: groups,
    elements: graph.elements.map((element) => {
      const groupId = memberOf.get(element.id);
      return groupId ? {...element, groupId} : element;
    }),
  };
};

/** Pipeline único de enriquecimento do grafo usado pela API. */
export const enrichSceneGraph = (graph: SceneGraph): SceneGraph =>
  buildMotionGroups(applyShapePreservation(attachTextElements(graph)));
