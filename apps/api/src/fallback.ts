import {inflateSync} from 'node:zlib';
import type {MotionPlan} from '@editorial-motion/motion-schema';
import type {SceneElement} from '@editorial-motion/scene-schema';

export type FallbackStrategy = 'normal' | 'merge_group' | 'reveal_only' | 'region_reveal' | 'fail';

export type FallbackDecision = {
  targetId: string;
  strategy: FallbackStrategy;
  reason: string;
};

export type MaskQuality = {coverageRatio: number};

export const OVERLAP_MERGE_THRESHOLD = 0.6;
export const PARTIAL_COVERAGE_THRESHOLD = 0.5;
export const MIN_COVERAGE_THRESHOLD = 0.05;
export const MIN_ISOLATION_CONFIDENCE = 0.5;
export const DEPTH_COVERAGE_THRESHOLD = 0.5;
const FULL_FRAME_COVERAGE = 0.9;

/**
 * Depth layering (issue #121): cena "efetivamente não dividida" — sem alvos animáveis,
 * cobertura baixa dos alvos, ou um único elemento full-frame (double de fallback).
 */
export const shouldDepthFallback = (elements: readonly SceneElement[]): boolean => {
  const targets = elements.filter(
    (element) => element.animatable && !element.protected && element.motionRole !== 'static' && element.motionRole !== 'protected',
  );
  const coverage = targets.reduce((sum, element) => sum + element.bbox.width * element.bbox.height, 0);
  if (targets.length === 0 || coverage < DEPTH_COVERAGE_THRESHOLD) return true;
  return targets.length === 1 && coverage >= FULL_FRAME_COVERAGE;
};

type Rect = {x: number; y: number; width: number; height: number};

const area = (box: Rect): number => box.width * box.height;

/** Intersection area over the smaller box area: how much of one element sits inside the other. */
export const overlapRatio = (a: Rect, b: Rect): number => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const smallest = Math.min(area(a), area(b));
  return smallest > 0 ? ((right - left) * (bottom - top)) / smallest : 0;
};

/**
 * Graded fallback decisions (SPEC §19):
 * A — highly overlapping elements merge into one group;
 * B — partial masks move only via reveal (original stays underneath);
 * C — empty mask but reliable bbox degrades to a whole-region reveal;
 * D — empty mask and unreliable bbox fails the job.
 */
export const planFallbacks = (
  elements: readonly SceneElement[],
  masks: Record<string, MaskQuality>,
): FallbackDecision[] => {
  const decisions: FallbackDecision[] = [];
  const animatable = elements.filter((element) => element.animatable);
  const overlapping = new Set<string>();
  for (let i = 0; i < animatable.length; i += 1) {
    for (let j = i + 1; j < animatable.length; j += 1) {
      if (overlapRatio(animatable[i].bbox, animatable[j].bbox) >= OVERLAP_MERGE_THRESHOLD) {
        overlapping.add(animatable[i].id);
        overlapping.add(animatable[j].id);
      }
    }
  }
  for (const element of animatable) {
    if (overlapping.has(element.id)) {
      decisions.push({targetId: element.id, strategy: 'merge_group', reason: 'highly overlaps another animatable element'});
      continue;
    }
    const coverage = masks[element.id]?.coverageRatio ?? 0;
    if (coverage < MIN_COVERAGE_THRESHOLD) {
      decisions.push(
        element.confidence >= MIN_ISOLATION_CONFIDENCE
          ? {targetId: element.id, strategy: 'region_reveal', reason: `mask coverage ${coverage.toFixed(3)} below ${MIN_COVERAGE_THRESHOLD} but bbox confidence ${element.confidence}`}
          : {targetId: element.id, strategy: 'fail', reason: `mask coverage ${coverage.toFixed(3)} below ${MIN_COVERAGE_THRESHOLD} and bbox confidence ${element.confidence}`},
      );
    } else if (coverage < PARTIAL_COVERAGE_THRESHOLD) {
      decisions.push({targetId: element.id, strategy: 'reveal_only', reason: `partial mask coverage ${coverage.toFixed(3)}`});
    }
  }
  return decisions;
};

/** Fallback A applied to the element list: each overlap cluster collapses into its first element with the union bbox. */
export const mergeOverlappingElements = (
  elements: readonly SceneElement[],
): {elements: SceneElement[]; merged: Record<string, string[]>} => {
  const animatable = elements.filter((element) => element.animatable);
  const clusters: SceneElement[][] = [];
  for (const element of animatable) {
    const cluster = clusters.find((members) => members.some((other) => overlapRatio(other.bbox, element.bbox) >= OVERLAP_MERGE_THRESHOLD));
    if (cluster) cluster.push(element);
    else clusters.push([element]);
  }
  const replacements = new Map<string, SceneElement>();
  const merged: Record<string, string[]> = {};
  const removed = new Set<string>();
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const [kept, ...rest] = cluster;
    const x1 = Math.min(...cluster.map((element) => element.bbox.x));
    const y1 = Math.min(...cluster.map((element) => element.bbox.y));
    const x2 = Math.max(...cluster.map((element) => element.bbox.x + element.bbox.width));
    const y2 = Math.max(...cluster.map((element) => element.bbox.y + element.bbox.height));
    replacements.set(kept.id, {
      ...kept,
      label: cluster.map((element) => element.label).join(' + '),
      bbox: {x: x1, y: y1, width: x2 - x1, height: y2 - y1},
      confidence: Math.min(...cluster.map((element) => element.confidence)),
    });
    merged[kept.id] = rest.map((element) => element.id);
    for (const element of rest) removed.add(element.id);
  }
  return {elements: elements.map((element) => replacements.get(element.id) ?? element).filter((element) => !removed.has(element.id)), merged};
};

const REVEAL_EVENT_TYPES = new Set(['mask_reveal', 'wipe_reveal', 'draw_path', 'draw_arrow', 'fade_in']);

/** Fallback B/C applied to the plan: restricted elements never move — their events become mask reveals. */
export const normalizePlanForFallbacks = (plan: MotionPlan, decisions: readonly FallbackDecision[]): MotionPlan => {
  const restricted = new Set(
    decisions.filter((decision) => decision.strategy === 'reveal_only' || decision.strategy === 'region_reveal').map((decision) => decision.targetId),
  );
  if (restricted.size === 0) return plan;
  return {
    ...plan,
    events: plan.events.map((event) =>
      restricted.has(event.targetId) && !REVEAL_EVENT_TYPES.has(event.type) ? {...event, type: 'mask_reveal' as const, params: {}} : event,
    ),
  };
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Ratio of "on" pixels in an 8-bit grayscale (color type 0) or RGBA (color type 6) PNG mask. */
export const pngCoverage = (png: Buffer): number => {
  if (png.length < 33 || !png.subarray(0, 8).equals(pngSignature)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      bitDepth = png[offset + 16];
      colorType = png[offset + 17];
    } else if (type === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 0 && colorType !== 6)) {
    throw new Error(`unsupported PNG mask format: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : 1;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const recon = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const source = raw[row * (stride + 1) + 1 + i];
      const left = i >= bytesPerPixel ? recon[row * stride + i - bytesPerPixel] : 0;
      const up = row > 0 ? recon[(row - 1) * stride + i] : 0;
      const upLeft = row > 0 && i >= bytesPerPixel ? recon[(row - 1) * stride + i - bytesPerPixel] : 0;
      let value: number;
      if (filter === 0) value = source;
      else if (filter === 1) value = source + left;
      else if (filter === 2) value = source + up;
      else if (filter === 3) value = source + ((left + up) >> 1);
      else if (filter === 4) value = source + paeth(left, up, upLeft);
      else throw new Error(`unsupported PNG filter: ${filter}`);
      recon[row * stride + i] = value & 0xff;
    }
  }
  let on = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sample = colorType === 6 ? recon[pixel * 4 + 3] : recon[pixel];
    if (sample > 127) on += 1;
  }
  return on / (width * height);
};
