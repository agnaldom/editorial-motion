import {advanceJob, failJob, type JobStage, type RenderJob} from './jobs';
import {renderMetrics, type RenderMetrics as RenderMetricsType} from './observability';

export type PipelineContext = {
  image: Buffer;
  prompt: string;
  artifacts: Record<string, unknown>;
  jobId?: string;
  input?: {
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    outputFileName?: string;
  };
};

export type PipelineStage = Exclude<JobStage, 'queued' | 'completed' | 'failed'>;
export type StageHandler = (context: PipelineContext) => Promise<PipelineContext>;
export type PipelineProgress = (job: RenderJob) => void | Promise<void>;

export type JobLogFn = (event: Record<string, unknown>) => void;

export type PipelineInstrument = {
  metrics?: RenderMetricsType;
  log?: JobLogFn;
  prompt?: string;
};

// SPEC §31: prompt só entra no log quando LOG_PROMPTS=true (prompts podem conter dados sensíveis).
const logPrompts = (): boolean => process.env.LOG_PROMPTS === 'true';

const jobEvent = (job: RenderJob, event: Record<string, unknown>, prompt?: string): Record<string, unknown> => ({
  msg: 'job stage event',
  jobId: job.id,
  requestId: job.requestId,
  attempt: job.attempt,
  ...(logPrompts() && prompt ? {prompt} : {}),
  ...event,
});

const defaultStages: PipelineStage[] = [
  'validating', 'normalizing', 'analyzing', 'detecting', 'segmenting',
  'extracting_layers', 'inpainting', 'planning_motion', 'validating_plan',
  'rendering', 'verifying_output',
];

export const runPipeline = async (
  initialJob: RenderJob,
  initialContext: PipelineContext,
  handlers: Partial<Record<PipelineStage, StageHandler>>,
  onProgress: PipelineProgress = () => undefined,
  stages: PipelineStage[] = defaultStages,
  instrument: PipelineInstrument = {},
): Promise<{job: RenderJob; context: PipelineContext}> => {
  let job = initialJob;
  let context = initialContext;
  const metrics = instrument.metrics ?? renderMetrics;
  const startedAt = Date.now();
  try {
    for (const stage of stages) {
      job = advanceJob(job, stage);
      await onProgress(job);
      const handler = handlers[stage];
      const stageStartedAt = Date.now();
      if (handler) context = await handler(context);
      const elapsedMs = Date.now() - stageStartedAt;
      metrics.record(stage, elapsedMs);
      instrument.log?.(jobEvent(job, {stage, elapsedMs, success: true}, instrument.prompt));
    }
    job = advanceJob(job, 'completed');
    await onProgress(job);
    metrics.recordJob(Date.now() - startedAt, false);
    return {job, context};
  } catch (error) {
    const stageError = error instanceof Error ? error : new Error('Pipeline stage failed');
    const code = (stageError as unknown as {code?: unknown}).code;
    const details = (stageError as unknown as {details?: Record<string, unknown>}).details;
    metrics.recordJob(Date.now() - startedAt, true);
    instrument.log?.(jobEvent(job, {stage: job.stage, success: false, code: typeof code === 'string' ? code : 'PIPELINE_STAGE_FAILED', error: stageError.message}, instrument.prompt));
    job = failJob(job, typeof code === 'string' ? code : 'PIPELINE_STAGE_FAILED', stageError.message, {details});
    await onProgress(job);
    throw Object.assign(stageError, {job});
  }
};
