import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {motionPlanSchema} from '@editorial-motion/motion-schema';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import {sceneAnalysisSchema, type SceneAnalysis} from '@editorial-motion/scene-schema';
import {analysisCacheKey, MemoryCache, type ProviderVersions} from '@editorial-motion/shared';
import {z} from 'zod';
import {analyzeScene, type SemanticVisionProvider} from './scene-analyzer';
import {createMotionPlan, type MotionPlannerProvider} from './motion-planner';
import {createSceneAnalyzer, createMotionPlanner} from './llm-providers';
import {DeterministicMotionPlanner} from './doubles';
import {validateImage} from './input';
import {type ImageDimensions} from './image-size';
import {inspectImage, normalizeImage, type ImageInspection} from './normalize';
import {solidMaskPng} from './png';
import {mergeOverlappingElements, normalizePlanForFallbacks, planFallbacks, pngCoverage, type FallbackDecision, type MaskQuality} from './fallback';
import {runPipeline, type PipelineContext, type PipelineStage, type StageHandler} from './pipeline';
import {renderMetrics} from './observability';
import type {RenderJob} from './jobs';
import type {StorageDriver} from './storage';

const execFileAsync = promisify(execFile);

export interface RenderService {
  render(inputPath: string, outputPath: string, timeoutMs?: number): Promise<void>;
}

export class RemotionCliRenderService implements RenderService {
  private readonly rendererDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../renderer');

  async render(inputPath: string, outputPath: string, timeoutMs = 600_000): Promise<void> {
    const tsx = path.join(this.rendererDir, 'node_modules', '.bin', 'tsx');
    const script = path.join(this.rendererDir, 'src', 'render.ts');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(tsx, [script, '--input', inputPath, '--output', outputPath], {
        cwd: this.rendererDir,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Object.assign(new Error(`Renderer timed out after ${timeoutMs}ms`), {code: 'TIMEOUT'}));
      }, timeoutMs);
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
const visionCache = new MemoryCache<string>();

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
};

export const buildStageHandlers = (deps: StageDeps): Record<PipelineStage, StageHandler> => ({
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
    let bundle = parseBundle(visionCache.get(cacheKey));
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
    visionCache.set(cacheKey, JSON.stringify(bundle));
    await deps.storage.put(artifact(context, 'analysis/scene-analysis.json'), JSON.stringify(analysis, null, 2));
    return {...context, artifacts: {...context.artifacts, analysis, visionBundle: bundle, visionCacheKey: cacheKey}};
  },

  detecting: async (context) => {
    const analysis = context.artifacts.analysis as SceneAnalysis;
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
    for (const element of analysis.elements.filter((item) => item.animatable)) {
      const cached = masks[element.id];
      const mask = cached ? Buffer.from(cached, 'base64') : solidMaskPng(dims.width, dims.height);
      if (!cached) masks = {...masks, [element.id]: mask.toString('base64')};
      qualities[element.id] = {coverageRatio: pngCoverage(mask)};
      await deps.storage.put(artifact(context, `masks/${element.id}.png`), mask);
    }
    if (masks !== bundle.masks) {
      visionCache.set(context.artifacts.visionCacheKey as string, JSON.stringify({...bundle, masks}));
    }
    const decisions = planFallbacks(analysis.elements, masks);
    const failed = decisions.filter((decision) => decision.strategy === 'fail');
    if (failed.length > 0) {
      throw codedError('SEGMENTATION_LOW_CONFIDENCE', `Could not isolate elements with sufficient confidence: ${failed.map((decision) => decision.targetId).join(', ')}`);
    }
    await deps.storage.put(artifact(context, 'analysis/fallbacks.json'), JSON.stringify(decisions, null, 2));
    return {...context, artifacts: {...context.artifacts, fallbackDecisions: decisions}};
  },

  extracting_layers: async (context) => {
    const analysis = context.artifacts.analysis as SceneAnalysis;
    const {elements: mergedElements, merged} = mergeOverlappingElements(analysis.elements);
    const mergedAnalysis: SceneAnalysis = {...analysis, elements: mergedElements};
    const layers: Array<{targetId: string; label: string; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; zIndex: number; maskRef: string; layerRef: string; routePaths?: [number, number][][]}> = mergedElements.filter((item) => item.animatable).map((element) => ({
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
    for (const layer of layers) {
      await deps.storage.put(layer.layerRef, context.image);
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
      allowedMotionTypes: ['fade_in', 'drop'],
    });
    const plan = normalizePlanForFallbacks(rawPlan, (context.artifacts.fallbackDecisions ?? []) as FallbackDecision[]);
    await deps.storage.put(artifact(context, 'motion/motion-plan.json'), JSON.stringify(plan, null, 2));
    return {...context, artifacts: {...context.artifacts, plan}};
  },

  validating_plan: async (context) => {
    const plan = motionPlanSchema.parse(context.artifacts.plan);
    const validation = validateMotionPlan(plan, context.artifacts.analysis as SceneAnalysis);
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
    await deps.renderService.render(inputPath, deps.storage.resolvePath(outputKey), Number(process.env.RENDER_TIMEOUT_MS ?? 600_000));
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
    await deps.storage.put(artifact(context, 'output/probe.json'), JSON.stringify(probe, null, 2));
    return context;
  },
});

type ProcessDeps = {
  repository: {get(id: string): Promise<RenderJob | undefined>; save(job: RenderJob): Promise<void>};
  storage: StorageDriver;
  renderService: RenderService;
  analyzer?: SemanticVisionProvider;
  motionPlanner?: MotionPlannerProvider;
  log?: (event: Record<string, unknown>) => void;
};

export const processJob = async (jobId: string, deps: ProcessDeps): Promise<void> => {
  const job = await deps.repository.get(jobId);
  if (!job?.inputAssetKey) return;
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
    },
    artifacts: {},
  };
  await runPipeline(
    job,
    context,
    buildStageHandlers({storage: deps.storage, renderService: deps.renderService, updateJob, analyzer: deps.analyzer, motionPlanner: deps.motionPlanner}),
    (progressJob) => {
      deps.repository.get(progressJob.id).then((current) => {
        deps.repository.save({...current, ...progressJob});
      });
    },
    undefined,
    {metrics: renderMetrics, log: deps.log, prompt: context.prompt},
  );
};
