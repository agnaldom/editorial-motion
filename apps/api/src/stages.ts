import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {motionPlanSchema} from '@editorial-motion/motion-schema';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import {sceneElementSchema, sceneAnalysisSchema, type SceneAnalysis, type SceneElement} from '@editorial-motion/scene-schema';
import {analysisCacheKey, type ProviderVersions} from '@editorial-motion/shared';
import {z} from 'zod';
import {analyzeScene, type SemanticVisionProvider} from './scene-analyzer';
import {createMotionPlan, type MotionPlannerProvider} from './motion-planner';
import {createSceneAnalyzer, createMotionPlanner} from './llm-providers';
import {DeterministicMotionPlanner} from './doubles';
import {validateImage} from './input';
import {type ImageDimensions} from './image-size';
import {inspectImage, normalizeImage, type ImageInspection} from './normalize';
import {solidMaskPng} from './png';
import {mergeOverlappingElements, normalizePlanForFallbacks, planFallbacks, pngCoverage, restrictLowRecoverability, shouldDepthFallback, type FallbackDecision, type MaskQuality} from './fallback';
import {applyDepthMotion, depthForegroundElement, DEPTH_FOREGROUND_ID, extractForegroundLayer, fetchForegroundSaliency} from './depth';
import {SUPPORTED_MOTION_TYPES} from './motion-vocabulary';
import {runPipeline, type PipelineContext, type PipelineStage, type StageHandler} from './pipeline';
import {classifyLayerability, enrichSceneGraph, sceneAnalysisToSceneGraph, validateSceneGraph, type SceneGraph} from '@editorial-motion/scene-schema';
import {scoreStrategies} from '@editorial-motion/motion-strategies';
import {annotatedVisualization, contactSheet} from './debug-artifacts';
import {codeOf} from './errors';
import {CancellationRegistry} from './cancellations';
import {closeSharedVisionCache, sharedVisionCache} from './cache';
import {finalFrameSsim, postRenderQuality, ssimThreshold, STATIC_ACTIVITY_THRESHOLD} from './quality';
import {renderMetrics} from './observability';
import {stageBaseProgress, cancelJob, type RenderJob} from './jobs';
import {VisionServiceClient, type VisionDetection} from './vision-client';
import type {StorageDriver} from './storage';

const execFileAsync = promisify(execFile);

export interface RenderService {
  render(inputPath: string, outputPath: string, timeoutMs?: number, onProgress?: (percent: number) => void): Promise<void>;
}

// Linhas de progresso do renderer (apps/renderer/src/render.ts): "render 42%".
export const parseRenderProgress = (line: string): number | null => {
  const match = /^render (\d{1,3})%$/.exec(line.trim());
  return match ? Math.min(100, Number(match[1])) : null;
};

export class RemotionCliRenderService implements RenderService {
  private readonly rendererDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../renderer');

  async render(inputPath: string, outputPath: string, timeoutMs = 600_000, onProgress?: (percent: number) => void): Promise<void> {
    const tsx = path.join(this.rendererDir, 'node_modules', '.bin', 'tsx');
    const script = path.join(this.rendererDir, 'src', 'render.ts');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(tsx, [script, '--input', inputPath, '--output', outputPath], {
        cwd: this.rendererDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Object.assign(new Error(`Renderer timed out after ${timeoutMs}ms`), {code: 'TIMEOUT'}));
      }, timeoutMs);
      child.stdout.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
          const percent = parseRenderProgress(line);
          if (percent !== null) onProgress?.(percent);
        }
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-1000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`Renderer exited with code ${code}: ${stderr}`), {code: 'RENDER_FAILED'}));
      });
    });
  }
}

// ponytail: test double; a real check would need a valid MP4, which only the real renderer produces.
export class FakeRenderService implements RenderService {
  async render(_inputPath: string, outputPath: string): Promise<void> {
    await mkdir(path.dirname(outputPath), {recursive: true});
    await writeFile(outputPath, Buffer.from('fake mp4 output'));
  }
}

export type VideoProbe = {width: number; height: number; fps: number; durationSeconds: number};

export const probeVideo = async (filePath: string): Promise<VideoProbe | null> => {
  try {
    const {stdout} = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate:format=duration',
      '-of', 'json', filePath,
    ]);
    const parsed = JSON.parse(stdout) as {streams?: Array<{width: number; height: number; avg_frame_rate: string}>; format?: {duration?: string}};
    const stream = parsed.streams?.[0];
    if (!stream) return null;
    const [num, den] = stream.avg_frame_rate.split('/').map(Number);
    return {
      width: stream.width,
      height: stream.height,
      fps: num / (den || 1),
      durationSeconds: Number(parsed.format?.duration ?? 0),
    };
  } catch {
    return null;
  }
};

const codedError = (code: string, message: string): Error => Object.assign(new Error(message), {code});

const artifact = (context: PipelineContext, name: string): string => `jobs/${context.jobId}/${name}`;

// SPEC §27: análise/segmentação reutilizáveis por hash da imagem + versões de modelo.
// ponytail: cache em memória no processo; upgrade: Redis/S3 para sobreviver a restarts.
const visionBundleSchema = z.object({analysis: sceneAnalysisSchema, masks: z.record(z.string())});
type VisionBundle = z.infer<typeof visionBundleSchema>;
// ponytail: cache de visão plugável e lazy (Redis sobrevive a restart — issue #125);
// sem REDIS_URL cai no MemoryCache de processo.
const visionCache = () => sharedVisionCache();

// ponytail: versões espelham os placeholders V1; com providers reais, virar de metadado do provider.
const providerVersions = (): ProviderVersions => ({
  visionModel: process.env.MOTION_VISION_MODEL ?? process.env.MOTION_LLM_MODEL ?? 'auto/coding',
  segmentationModel: 'placeholder-solid-mask',
  inpaintingModel: 'placeholder-copy',
});

const parseBundle = (raw: string | undefined): VisionBundle | undefined => {
  if (!raw) return undefined;
  const parsed = visionBundleSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : undefined;
};

type StageDeps = {
  storage: StorageDriver;
  renderService: RenderService;
  updateJob: (patch: Partial<RenderJob>) => Promise<void>;
  analyzer?: SemanticVisionProvider;
  motionPlanner?: MotionPlannerProvider;
  vision?: VisionServiceClient;
};

// ponytail: slug minimalista espelha _slug() do vision-service (providers.py), sem dep extra.
const slugify = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'element';

// Chute conservador de tipo por label quando o detector substitui o elemento único de fallback.
const guessElementType = (label: string): SceneElement['type'] => {
  if (/route|arrow|line/i.test(label)) return 'route';
  if (/text|label|number/i.test(label)) return 'text';
  return 'cutout';
};

// Mescla detections reais na análise semântica: substitui o elemento único de fallback
// (doubles.ts) ou refina bbox/confidence dos elementos cujo label confere (case-insensitive).
const applyDetections = (analysis: SceneAnalysis, detections: VisionDetection[]): SceneAnalysis => {
  const isSingleFallback = analysis.elements.length === 1 && analysis.elements[0].id === 'composition';
  if (!isSingleFallback) {
    const byLabel = new Map(detections.map((detection) => [detection.label.toLowerCase(), detection]));
    return {
      ...analysis,
      elements: analysis.elements.map((element) => {
        const detection = byLabel.get(element.label.toLowerCase());
        return detection ? {...element, bbox: detection.bbox, confidence: detection.confidence} : element;
      }),
    };
  }
  const usedIds = new Set<string>();
  const elements = detections.map((detection, index) => {
    let id = `det_${slugify(detection.label)}`;
    while (usedIds.has(id)) id = `det_${slugify(detection.label)}_${index}`;
    usedIds.add(id);
    return sceneElementSchema.parse({
      id,
      label: detection.label,
      type: guessElementType(detection.label),
      bbox: detection.bbox,
      confidence: detection.confidence,
      zIndex: index + 1,
      animatable: true,
      protected: false,
      motionRole: 'primary',
      source: 'detector',
    });
  });
  return {...analysis, compositionType: 'mixed', elements};
};

// SPEC §18: estágios que hoje não carregam código próprio ganham o código do catálogo.
const withStageCode = (handler: StageHandler, code: string): StageHandler => async (context) => {
  try {
    return await handler(context);
  } catch (error) {
    if (codeOf(error)) throw error;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {code});
  }
};

export const buildStageHandlers = (deps: StageDeps): Record<PipelineStage, StageHandler> => {
  // SPEC V2 §51: artefatos de debug só são gravados quando o job roda com debug=true.
  const putDebug = async (context: PipelineContext, name: string, data: string | Buffer): Promise<void> => {
    if (context.input?.debug === true) await deps.storage.put(artifact(context, `debug/${name}`), data);
  };
  const handlers: Record<PipelineStage, StageHandler> = {
  validating: async (context) => {
    await validateImage(context.image);
    const inspection = await inspectImage(context.image);
    return {...context, artifacts: {...context.artifacts, inspection}};
  },

  // SPEC §8 Stage 1: EXIF aplicado, sRGB, proxy de análise + metadados de escala.
  normalizing: async (context) => {
    const inspection = context.artifacts.inspection as ImageInspection;
    const {proxy, scale} = await normalizeImage(context.image, inspection);
    await deps.storage.put(artifact(context, 'analysis/analysis-proxy.json'), JSON.stringify(scale, null, 2));
    return {...context, artifacts: {...context.artifacts, dims: {width: inspection.width, height: inspection.height}, proxy, scale}};
  },

  analyzing: async (context) => {
    const analyzer = deps.analyzer ?? createSceneAnalyzer();
    const cacheKey = analysisCacheKey(context.image, providerVersions());
    let bundle = parseBundle(await visionCache().get(cacheKey));
    if (!bundle) {
      const analysis = await analyzeScene(analyzer, context.image, context.prompt);
      bundle = {analysis, masks: {}};
    }
    // Enriquecimento é idempotente (dims derivam do hash da imagem), então o bundle
    // gravado no cache já sai enriquecido.
    const analysis: SceneAnalysis = {
      ...bundle.analysis,
      source: {...bundle.analysis.source, ...(context.artifacts.dims as ImageDimensions), aspectRatio: (context.artifacts.dims as ImageDimensions).width / (context.artifacts.dims as ImageDimensions).height},
    };
    bundle = {...bundle, analysis};
    await visionCache().set(cacheKey, JSON.stringify(bundle));
    await deps.storage.put(artifact(context, 'analysis/scene-analysis.json'), JSON.stringify(analysis, null, 2));
    const sceneGraph = enrichSceneGraph(sceneAnalysisToSceneGraph(analysis));
    await putDebug(context, 'classification.json', JSON.stringify({
      classifications: analysis.classifications ?? [{type: analysis.compositionType, confidence: 1}],
    }, null, 2));
    await putDebug(context, 'scene-graph.json', JSON.stringify(sceneGraph, null, 2));
    await putDebug(context, 'source.png', context.image);
    return {...context, artifacts: {...context.artifacts, analysis, visionBundle: bundle, visionCacheKey: cacheKey, sceneGraph}};
  },

  detecting: async (context) => {
    let analysis = context.artifacts.analysis as SceneAnalysis;
    if (deps.vision && analysis.elements.length > 0) {
      try {
        const capabilities = await deps.vision.capabilities();
        if (capabilities?.detect) {
          const labels = [...new Set(analysis.elements.map((element) => element.label))].slice(0, 10);
          const detections = await deps.vision.detect(context.image, labels);
          if (detections.length > 0) {
            analysis = applyDetections(analysis, detections);
            const bundle = context.artifacts.visionBundle as VisionBundle;
            const updatedBundle = {...bundle, analysis};
            await visionCache().set(context.artifacts.visionCacheKey as string, JSON.stringify(updatedBundle));
            context = {...context, artifacts: {...context.artifacts, analysis, visionBundle: updatedBundle}};
          }
        }
      } catch {
        // ponytail: detector indisponível/erro HTTP → segue com a análise semântica (SPEC §8).
      }
    }
    const detections = analysis.elements.map((element) => ({
      elementId: element.id, label: element.label, bbox: element.bbox, confidence: element.confidence,
    }));
    await deps.storage.put(artifact(context, 'analysis/detections.json'), JSON.stringify(detections, null, 2));
    return context;
  },

  segmenting: async (context) => {
    const dims = context.artifacts.dims as ImageDimensions;
    const analysis = context.artifacts.analysis as SceneAnalysis;
    const bundle = context.artifacts.visionBundle as VisionBundle;
    let masks = bundle.masks;
    const qualities: Record<string, MaskQuality> = {};
    const animatable = analysis.elements.filter((item) => item.animatable);
    // ponytail: mapeamento por íNDICE (contrato /v1/segment preserva a ordem do request);
    // elemento sem máscara respondida cai no solidMaskPng abaixo.
    let visionMasks: Record<string, Buffer> = {};
    if (deps.vision && animatable.length > 0) {
      try {
        const capabilities = await deps.vision.capabilities();
        if (capabilities?.segment) {
          const detections = animatable.map((element) => ({
            label: element.label, confidence: element.confidence, bbox: element.bbox,
          }));
          const results = await deps.vision.segment(context.image, detections);
          const entries: Array<[string, Buffer]> = [];
          results.forEach((mask, index) => {
            const element = animatable[index];
            if (element && mask.maskPng.length > 0) entries.push([element.id, mask.maskPng]);
          });
          visionMasks = Object.fromEntries(entries);
        }
      } catch {
        // ponytail: segmentador indisponível → máscaras sólidas como antes (SPEC §9).
        visionMasks = {};
      }
    }
    for (const element of animatable) {
      const real = visionMasks[element.id];
      const cached = masks[element.id];
      const mask = real ?? (cached ? Buffer.from(cached, 'base64') : solidMaskPng(dims.width, dims.height));
      // ponytail: máscara real do vision-service sobrescreve o cache do bundle (inclui solid).
      if (mask.toString('base64') !== cached) masks = {...masks, [element.id]: mask.toString('base64')};
      qualities[element.id] = {coverageRatio: pngCoverage(mask)};
      await deps.storage.put(artifact(context, `masks/${element.id}.png`), mask);
    }
    if (masks !== bundle.masks) {
      await visionCache().set(context.artifacts.visionCacheKey as string, JSON.stringify({...bundle, masks}));
    }
    const decisions = planFallbacks(analysis.elements, qualities);
    const failed = decisions.filter((decision) => decision.strategy === 'fail');
    if (failed.length > 0) {
      throw codedError('SEGMENTATION_LOW_CONFIDENCE', `Could not isolate elements with sufficient confidence: ${failed.map((decision) => decision.targetId).join(', ')}`);
    }
    await deps.storage.put(artifact(context, 'analysis/fallbacks.json'), JSON.stringify(decisions, null, 2));
    const graph = (context.artifacts.sceneGraph as SceneGraph | undefined) ?? sceneAnalysisToSceneGraph(analysis);
    await putDebug(context, 'layerability.json', JSON.stringify({
      thresholds: {layerMin: 0.72, regionMin: 0.45},
      elements: graph.elements.map((element) => ({
        id: element.id,
        layerability: element.layerability,
        decision: classifyLayerability(element.layerability),
        movable: element.movable,
      })),
    }, null, 2));
    return {...context, artifacts: {...context.artifacts, fallbackDecisions: decisions}};
  },

  extracting_layers: async (context) => {
    const analysis = context.artifacts.analysis as SceneAnalysis;

    // Depth layering (issue #121): cena não dividida → foreground saliente + plano de fundo.
    if (shouldDepthFallback(analysis.elements)) {
      const depthVisionUrl = process.env.VISION_SERVICE_URL;
      const saliency = await fetchForegroundSaliency(context.image, depthVisionUrl);
      const cutout = saliency ? await extractForegroundLayer(context.image, saliency.mask, depthVisionUrl ?? '') : null;
      if (saliency && cutout) {
        const element = depthForegroundElement(saliency.bbox);
        const maskRef = artifact(context, `masks/${DEPTH_FOREGROUND_ID}.png`);
        const layerRef = artifact(context, `layers/${DEPTH_FOREGROUND_ID}.png`);
        await deps.storage.put(maskRef, saliency.mask);
        await deps.storage.put(layerRef, cutout);
        const layer = {
          targetId: element.id, label: element.label,
          x: element.bbox.x, y: element.bbox.y, width: element.bbox.width, height: element.bbox.height,
          anchorX: 0.5, anchorY: 0.5, zIndex: element.zIndex, maskRef, layerRef,
        };
        await deps.storage.put(artifact(context, 'layers/layers.json'), JSON.stringify([layer], null, 2));
        const updated: SceneAnalysis = {...analysis, elements: [element], compositionType: 'editorial-collage'};
        await deps.storage.put(artifact(context, 'analysis/scene-analysis.json'), JSON.stringify(updated, null, 2));
        return {...context, artifacts: {...context.artifacts, analysis: updated, layers: [layer], depthFallback: true}};
      }
      // serviço indisponível: segue o fluxo normal (planning pode falhar com NO_ANIMATABLE_ELEMENTS)
    }

    const {elements: mergedElements, merged} = mergeOverlappingElements(analysis.elements);
    const mergedAnalysis: SceneAnalysis = {...analysis, elements: mergedElements};
    const layers: Array<{targetId: string; label: string; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; zIndex: number; maskRef: string; layerRef: string; routePaths?: [number, number][][]; recoverability?: number}> = mergedElements.filter((item) => item.animatable).map((element) => ({
      targetId: element.id,
      label: element.label,
      x: element.bbox.x,
      y: element.bbox.y,
      width: element.bbox.width,
      height: element.bbox.height,
      anchorX: 0.5,
      anchorY: 0.5,
      zIndex: element.zIndex,
      maskRef: artifact(context, `masks/${element.id}.png`),
      layerRef: artifact(context, `layers/${element.id}.png`),
    }));
    const visionUrl = process.env.VISION_SERVICE_URL;
    let visionLayers = false;
    if (deps.vision) {
      try {
        visionLayers = (await deps.vision.capabilities()) !== null;
      } catch {
        // ponytail: capabilities nunca lança; guarda defensiva → fallback por cópia.
        visionLayers = false;
      }
    }
    const manifestLayers: Array<Record<string, unknown>> = [];
    for (const layer of layers) {
      let layerBytes = context.image;
      if (deps.vision && visionLayers) {
        try {
          const mask = await deps.storage.get(layer.maskRef);
          const extracted = await deps.vision.extractLayer(context.image, mask, {
            elementId: layer.targetId,
            label: layer.label,
            zIndex: layer.zIndex,
            maskRef: layer.maskRef,
            layerRef: layer.layerRef,
          });
          layerBytes = extracted.layer;
          // Recorte real exige o bbox do alpha refinado, não o bbox bruto do detector.
          layer.x = extracted.metadata.bbox.x;
          layer.y = extracted.metadata.bbox.y;
          layer.width = extracted.metadata.bbox.width;
          layer.height = extracted.metadata.bbox.height;
          // SPEC V2 §16 (issue #150): recoverability mede se o fundo atrás do objeto
          // pode ser reconstruído — o planner trava movimentos grandes quando baixo.
          if (typeof extracted.metadata.recoverability === 'number') {
            layer.recoverability = extracted.metadata.recoverability;
          }
        } catch {
          // ponytail: extract falhou para este elemento → cópia da imagem com bbox do elemento.
        }
      }
      await deps.storage.put(layer.layerRef, layerBytes);
      manifestLayers.push({
        id: layer.targetId,
        bbox: {x: layer.x, y: layer.y, width: layer.width, height: layer.height},
        maskRef: layer.maskRef,
        layerRef: layer.layerRef,
        ...(layer.recoverability !== undefined ? {recoverability: layer.recoverability} : {}),
        bytes: layerBytes.length,
      });
      const element = analysis.elements.find((item) => item.id === layer.targetId);
      if (!visionUrl || !element || (element.type !== 'route' && element.type !== 'arrow')) continue;
      try {
        const mask = await deps.storage.get(layer.maskRef);
        const form = new FormData();
        form.append('mask', new Blob([new Uint8Array(mask)]), 'mask.png');
        const response = await fetch(new URL('/v1/routes/vectorize', visionUrl), {method: 'POST', body: form});
        if (response.ok) {
          const data = (await response.json()) as {paths: Array<{points: [number, number][]}>};
          layer.routePaths = data.paths.map((path) => path.points);
        }
      } catch {
        // ponytail: vectorize indisponível/falho → layer sem routePaths, renderer cai no wipe padrão
      }
    }
    await deps.storage.put(artifact(context, 'layers/layers.json'), JSON.stringify(layers, null, 2));
    // SPEC V2 §17: manifesto dos assets extraídos (scene-assets/manifest.json).
    await deps.storage.put(artifact(context, 'layers/manifest.json'), JSON.stringify({
      version: '1',
      sceneId: analysis.sceneId,
      layers: manifestLayers,
    }, null, 2));
    const updated: SceneAnalysis = {
      ...mergedAnalysis,
      elements: mergedElements.map((element) => {
        const layer = layers.find((item) => item.targetId === element.id);
        return layer ? {...element, maskRef: layer.maskRef, layerRef: layer.layerRef} : element;
      }),
    };
    await deps.storage.put(artifact(context, 'analysis/scene-analysis.json'), JSON.stringify(updated, null, 2));
    return {...context, artifacts: {...context.artifacts, analysis: updated, layers, mergedGroups: merged}};
  },

  inpainting: async (context) => {
    const analysis = context.artifacts.analysis as SceneAnalysis;
    if (deps.vision) {
      try {
        const capabilities = await deps.vision.capabilities();
        if (capabilities?.inpaint) {
          const masks: Buffer[] = [];
          for (const element of analysis.elements.filter((item) => item.animatable)) {
            const key = element.maskRef ?? artifact(context, `masks/${element.id}.png`);
            if (await deps.storage.exists(key)) masks.push(await deps.storage.get(key));
          }
          if (masks.length > 0) {
            const clean = await deps.vision.inpaint(context.image, masks);
            await deps.storage.put(artifact(context, 'background/background-clean.png'), clean);
            return context;
          }
        }
      } catch {
        // ponytail: inpaint falhou → cópia da imagem original como antes (SPEC §7.4).
      }
    }
    // ponytail: sem vision-service/capacidade → cópia; o endpoint /v1/inpaint aceita
    // additional_masks (união + dilatação radius 2) quando o provider real estiver ativo.
    await deps.storage.put(artifact(context, 'background/background-clean.png'), context.image);
    return context;
  },

  planning_motion: async (context) => {
    const input = context.input;
    if (!input) throw codedError('MOTION_PLAN_FAILED', 'Pipeline input is required for motion planning');
    const analysis = context.artifacts.analysis as SceneAnalysis;
    if (!analysis.elements.some((element) => element.animatable)) {
      throw codedError('NO_ANIMATABLE_ELEMENTS', 'Scene has no animatable elements; requested animation cannot be produced');
    }
    const planner = deps.motionPlanner ?? createMotionPlanner();
    const rawPlan = await createMotionPlan(planner, {
      prompt: context.prompt,
      durationSeconds: input.durationSeconds,
      fps: input.fps,
      canvas: {width: input.width, height: input.height},
      sceneAnalysis: analysis,
      allowedMotionTypes: [...SUPPORTED_MOTION_TYPES],
    });
    const normalized = normalizePlanForFallbacks(rawPlan, (context.artifacts.fallbackDecisions ?? []) as FallbackDecision[]);
    const withRecoverability = restrictLowRecoverability(normalized, Object.fromEntries(
      ((context.artifacts.layers ?? []) as Array<{targetId: string; recoverability?: number}>)
        .filter((layer) => typeof layer.recoverability === 'number')
        .map((layer) => [layer.targetId, layer.recoverability as number]),
    ));
    const plan = context.artifacts.depthFallback === true ? applyDepthMotion(withRecoverability) : withRecoverability;
    await deps.storage.put(artifact(context, 'motion/motion-plan.json'), JSON.stringify(plan, null, 2));
    const graph = (context.artifacts.sceneGraph as SceneGraph | undefined) ?? sceneAnalysisToSceneGraph(analysis);
    await putDebug(context, 'strategy-scores.json', JSON.stringify(scoreStrategies(graph), null, 2));
    return {...context, artifacts: {...context.artifacts, plan}};
  },

  validating_plan: async (context) => {
    const plan = motionPlanSchema.parse(context.artifacts.plan);
    const validation = validateMotionPlan(plan, context.artifacts.analysis as SceneAnalysis);
    const graph = (context.artifacts.sceneGraph as SceneGraph | undefined) ?? sceneAnalysisToSceneGraph(context.artifacts.analysis as SceneAnalysis);
    await putDebug(context, 'motion-validation.json', JSON.stringify({planValid: validation.valid, errors: validation.errors, warnings: validation.warnings, graphValid: validateSceneGraph(graph).valid}, null, 2));
    if (!validation.valid) throw codedError('MOTION_PLAN_INVALID', validation.errors.join('; '));
    return context;
  },

  rendering: async (context) => {
    const input = context.input;
    if (!input) throw codedError('RENDER_FAILED', 'Pipeline input is required for rendering');
    const plan = context.artifacts.plan;
    const layers = context.artifacts.layers as Array<{targetId: string; layerRef: string; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; zIndex: number; routePaths?: [number, number][][]}>;
    const props = {
      plan,
      background: deps.storage.resolvePath(artifact(context, 'background/background-clean.png')),
      layers: layers.map((layer) => ({
        elementId: layer.targetId,
        asset: deps.storage.resolvePath(layer.layerRef),
        placement: {
          x: layer.x, y: layer.y, width: layer.width, height: layer.height,
          anchorX: layer.anchorX, anchorY: layer.anchorY, zIndex: layer.zIndex,
        },
        ...(layer.routePaths ? {routePaths: layer.routePaths} : {}),
      })),
    };
    const inputPath = deps.storage.resolvePath(artifact(context, 'render-input.json'));
    await writeFile(inputPath, JSON.stringify(props));
    const outputKey = artifact(context, `output/${input.outputFileName ?? 'scene01.mp4'}`);
    // Progresso real do Remotion: cada linha "render N%" vira progresso fino,
    // mapeado na fatia do estágio rendering entre stageBaseProgress(rendering)
    // e stageBaseProgress(verifying_output).
    const renderBase = stageBaseProgress('rendering');
    const renderTop = stageBaseProgress('verifying_output');
    const onRenderProgress = (percent: number) => {
      const mapped = renderBase + Math.floor((percent / 100) * (renderTop - renderBase));
      deps.updateJob({stageProgress: percent, progress: Math.min(renderTop, mapped)}).catch(() => undefined);
    };
    await deps.renderService.render(inputPath, deps.storage.resolvePath(outputKey), Number(process.env.RENDER_TIMEOUT_MS ?? 600_000), onRenderProgress);
    // Re-put pelo storage para registrar o RenderArtifact 'video' (§25) e unificar o caminho de escrita.
    await deps.storage.put(outputKey, await readFile(deps.storage.resolvePath(outputKey)));
    await deps.updateJob({outputAssetKey: outputKey});
    return {...context, artifacts: {...context.artifacts, outputAssetKey: outputKey}};
  },

  verifying_output: async (context) => {
    const input = context.input;
    const outputKey = context.artifacts.outputAssetKey as string;
    const outputPath = deps.storage.resolvePath(outputKey);
    const fileStat = await stat(outputPath).catch(() => null);
    if (!fileStat || fileStat.size === 0) throw codedError('OUTPUT_VALIDATION_FAILED', 'Output file is missing or empty');
    if (!input) return context;
    const probe = await probeVideo(outputPath);
    if (!probe) return context; // ponytail: ffprobe unavailable — size check only; ceiling noted in issue #53.
    const problems: string[] = [];
    if (probe.width !== input.width || probe.height !== input.height) {
      problems.push(`expected ${input.width}x${input.height}, got ${probe.width}x${probe.height}`);
    }
    if (Math.abs(probe.fps - input.fps) > 1) problems.push(`expected ${input.fps} fps, got ${probe.fps.toFixed(2)}`);
    if (Math.abs(probe.durationSeconds - input.durationSeconds) > 0.5) {
      problems.push(`expected ${input.durationSeconds}s, got ${probe.durationSeconds.toFixed(2)}s`);
    }
    if (problems.length > 0) throw codedError('OUTPUT_VALIDATION_FAILED', problems.join('; '));
    // SPEC §29.3: SSIM final-frame vs source é métrica de AVISO (não gate único).
    const ssimValue = await finalFrameSsim(outputPath, context.image).catch(() => null);
    // SPEC V2 §36–§37/§62: quality gate pós-render — STATIC_RENDER_DETECTED falha o job.
    const quality = await postRenderQuality(outputPath, probe.durationSeconds).catch(() => null);
    const plan = context.artifacts.plan as {events?: Array<{targetId: string}>} | undefined;
    const animatedElements = new Set((plan?.events ?? []).map((event) => event.targetId)).size;
    const qualityReport = {
      ...(ssimValue === null ? {} : {
        finalFrameSsim: Number(ssimValue.toFixed(4)),
        ...(ssimValue < ssimThreshold() ? {qualityWarning: `final-frame SSIM ${ssimValue.toFixed(3)} below threshold ${ssimThreshold()}`} : {}),
      }),
      ...(quality === null ? {} : {
        renderPassed: quality.renderPassed,
        ...(quality.code ? {code: quality.code} : {}),
        metrics: {
          ...quality.metrics,
          animatedElements,
        },
      }),
    };
    await deps.storage.put(artifact(context, 'output/probe.json'), JSON.stringify(probe, null, 2));
    await deps.storage.put(artifact(context, 'output/quality-report.json'), JSON.stringify({probe, ...qualityReport}, null, 2));
    if (context.input?.debug === true) {
      // contact-sheet e bbox ajudam principalmente quando o render FALHA o gate —
      // por isso são gravados antes do throw.
      const sheetPath = deps.storage.resolvePath(artifact(context, 'debug/contact-sheet.jpg'));
      if (contactSheet(outputPath, probe.durationSeconds, sheetPath)) {
        await deps.storage.put(artifact(context, 'debug/contact-sheet.jpg'), await readFile(sheetPath));
      }
      const graph = (context.artifacts.sceneGraph as SceneGraph | undefined) ?? sceneAnalysisToSceneGraph(context.artifacts.analysis as SceneAnalysis);
      const analysisDims = context.artifacts.analysis as SceneAnalysis;
      const viz = await annotatedVisualization(
        context.image,
        analysisDims.source.width,
        analysisDims.source.height,
        graph.elements.map((element) => ({id: element.id, bbox: element.bbox, note: `layer:${element.layerability.toFixed(2)}`})),
      ).catch(() => null);
      if (viz) await putDebug(context, 'visualization.png', viz);
    }
    if (quality && !quality.renderPassed) {
      throw codedError('STATIC_RENDER_DETECTED', `render is effectively static (timelineActivity ${quality.metrics.timelineActivity} < threshold ${STATIC_ACTIVITY_THRESHOLD()})`);
    }
    return context;
  },
  };
  return {
    ...handlers,
    detecting: withStageCode(handlers.detecting, 'DETECTION_FAILED'),
    extracting_layers: withStageCode(handlers.extracting_layers, 'SEGMENTATION_FAILED'),
    inpainting: withStageCode(handlers.inpainting, 'BACKGROUND_RECONSTRUCTION_FAILED'),
    rendering: withStageCode(handlers.rendering, 'RENDER_FAILED'),
  };
};

type ProcessDeps = {
  repository: {get(id: string): Promise<RenderJob | undefined>; save(job: RenderJob): Promise<void>};
  storage: StorageDriver;
  renderService: RenderService;
  analyzer?: SemanticVisionProvider;
  motionPlanner?: MotionPlannerProvider;
  vision?: VisionServiceClient;
  cancellations?: CancellationRegistry;
  log?: (event: Record<string, unknown>) => void;
};

export const processJob = async (jobId: string, deps: ProcessDeps): Promise<void> => {
  const job = await deps.repository.get(jobId);
  if (!job?.inputAssetKey) return;
  // Cancelamento cooperativo (issue #124): job enfileirado que foi cancelado
  // antes do worker pegá-lo nunca inicia o pipeline.
  if (deps.cancellations?.isRequested(jobId)) {
    await deps.repository.save(cancelJob(job));
    return;
  }
  const image = await deps.storage.get(job.inputAssetKey);
  const updateJob = async (patch: Partial<RenderJob>): Promise<void> => {
    const current = await deps.repository.get(jobId);
    if (current) await deps.repository.save({...current, ...patch});
  };
  const context: PipelineContext = {
    jobId,
    image,
    prompt: job.prompt ?? '',
    input: {
      durationSeconds: job.durationSeconds ?? 8,
      width: job.width ?? 2560,
      height: job.height ?? 1440,
      fps: job.fps ?? 30,
      outputFileName: job.outputFileName,
      debug: job.debug === true,
    },
    artifacts: {},
  };
  // ponytail: client criado sob demanda pela env; testes injetam deps.vision direto.
  const vision = deps.vision ?? (process.env.VISION_SERVICE_URL ? new VisionServiceClient(process.env.VISION_SERVICE_URL) : undefined);
  await runPipeline(
    job,
    context,
    buildStageHandlers({storage: deps.storage, renderService: deps.renderService, updateJob, analyzer: deps.analyzer, motionPlanner: deps.motionPlanner, vision}),
    (progressJob) => {
      deps.repository.get(progressJob.id).then((current) => {
        deps.repository.save({...current, ...progressJob});
      });
    },
    undefined,
    {metrics: renderMetrics, log: deps.log, prompt: context.prompt, isCancelled: () => deps.cancellations?.isRequested(jobId) ?? false},
  );
};
