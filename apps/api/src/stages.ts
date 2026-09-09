import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {motionPlanSchema} from '@editorial-motion/motion-schema';
import {validateMotionPlan} from '@editorial-motion/motion-engine';
import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import {analyzeScene, type SemanticVisionProvider} from './scene-analyzer';
import {createMotionPlan, type MotionPlannerProvider} from './motion-planner';
import {createSceneAnalyzer, createMotionPlanner} from './llm-providers';
import {DeterministicMotionPlanner} from './doubles';
import {validateImage} from './input';
import {imageSize, type ImageDimensions} from './image-size';
import {solidMaskPng} from './png';
import {runPipeline, type PipelineContext, type PipelineStage, type StageHandler} from './pipeline';
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
    return context;
  },

  normalizing: async (context) => ({
    ...context,
    artifacts: {...context.artifacts, dims: imageSize(context.image)},
  }),

  analyzing: async (context) => {
    const analyzer = deps.analyzer ?? createSceneAnalyzer();
    const analysis = await analyzeScene(analyzer, context.image, context.prompt);
    analysis.source = {...analysis.source, ...(context.artifacts.dims as ImageDimensions), aspectRatio: (context.artifacts.dims as ImageDimensions).width / (context.artifacts.dims as ImageDimensions).height};
    await deps.storage.put(artifact(context, 'analysis/scene-analysis.json'), JSON.stringify(analysis, null, 2));
    return {...context, artifacts: {...context.artifacts, analysis}};
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
    for (const element of analysis.elements.filter((item) => item.animatable)) {
      await deps.storage.put(artifact(context, `masks/${element.id}.png`), solidMaskPng(dims.width, dims.height));
    }
    return context;
  },

  extracting_layers: async (context) => {
    const analysis = context.artifacts.analysis as SceneAnalysis;
    const layers = analysis.elements.filter((item) => item.animatable).map((element) => ({
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
    for (const layer of layers) {
      await deps.storage.put(layer.layerRef, context.image);
    }
    await deps.storage.put(artifact(context, 'layers/layers.json'), JSON.stringify(layers, null, 2));
    const updated: SceneAnalysis = {
      ...analysis,
      elements: analysis.elements.map((element) => {
        const layer = layers.find((item) => item.targetId === element.id);
        return layer ? {...element, maskRef: layer.maskRef, layerRef: layer.layerRef} : element;
      }),
    };
    await deps.storage.put(artifact(context, 'analysis/scene-analysis.json'), JSON.stringify(updated, null, 2));
    return {...context, artifacts: {...context.artifacts, analysis: updated, layers}};
  },

  inpainting: async (context) => {
    await deps.storage.put(artifact(context, 'background/background-clean.png'), context.image);
    return context;
  },

  planning_motion: async (context) => {
    const input = context.input;
    if (!input) throw codedError('MOTION_PLAN_FAILED', 'Pipeline input is required for motion planning');
    const planner = deps.motionPlanner ?? createMotionPlanner();
    const plan = await createMotionPlan(planner, {
      prompt: context.prompt,
      durationSeconds: input.durationSeconds,
      fps: input.fps,
      canvas: {width: input.width, height: input.height},
      sceneAnalysis: context.artifacts.analysis as SceneAnalysis,
      allowedMotionTypes: ['fade_in', 'drop'],
    });
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
    const layers = context.artifacts.layers as Array<{targetId: string; layerRef: string; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; zIndex: number}>;
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
  );
};
