import {advanceJob, cancelJob, failJob, type JobStage, type RenderJob} from './jobs';
import {codeOf, nonRetryableCodes} from './errors';
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
    debug?: boolean;
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
  isCancelled?: () => boolean;
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

// SPEC §26: 2 tentativas para visão/segmentação/extração/inpainting/render;
// motion LLM tem retry interno com repair (3 attempts) e validação é determinística.
export const stageRetryAttempts: Partial<Record<PipelineStage, number>> = {
  analyzing: 2,
  detecting: 2,
  segmenting: 2,
  extracting_layers: 2,
  inpainting: 2,
  rendering: 2,
};

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
  let stageAttempts = 0;
  try {
    for (const stage of stages) {
      // Cancelamento cooperativo: verificado entre stages (issue #124).
      if (instrument.isCancelled?.()) throw Object.assign(new Error('Render job cancelled'), {code: 'CANCELLED'});
      job = advanceJob(job, stage);
      await onProgress(job);
      const handler = handlers[stage];
      const stageStartedAt = Date.now();
      const maxAttempts = stageRetryAttempts[stage] ?? 1;
      stageAttempts = 0;
      for (;;) {
        stageAttempts += 1;
        try {
          if (handler) context = await handler(context);
          break;
        } catch (error) {
          const code = codeOf(error) ?? 'INTERNAL_ERROR';
          const willRetry = stageAttempts < maxAttempts && !nonRetryableCodes.has(code);
          instrument.log?.(jobEvent(
            job,
            {stage, attempt: stageAttempts, success: false, code, willRetry, error: error instanceof Error ? error.message : String(error)},
            instrument.prompt,
          ));
          if (!willRetry) throw error;
        }
      }
      const elapsedMs = Date.now() - stageStartedAt;
      metrics.record(stage, elapsedMs);
      instrument.log?.(jobEvent(job, {stage, elapsedMs, attempt: stageAttempts, success: true}, instrument.prompt));
    }
    job = advanceJob(job, 'completed');
    await onProgress(job);
    metrics.recordJob(Date.now() - startedAt, false);
    return {job, context};
  } catch (error) {
    const stageError = error instanceof Error ? error : new Error('Pipeline stage failed');
    const code = (stageError as unknown as {code?: unknown}).code;
    const details = (stageError as unknown as {details?: Record<string, unknown>}).details;
    const cancelled = code === 'CANCELLED';
    metrics.recordJob(Date.now() - startedAt, !cancelled);
    instrument.log?.(jobEvent(job, {stage: job.stage, success: false, code: typeof code === 'string' ? code : 'INTERNAL_ERROR', error: stageError.message}, instrument.prompt));
    // Cancelado não é falha de pipeline: status dedicado, sem métrica de falha.
    job = cancelled
      ? cancelJob(job)
      : failJob(job, typeof code === 'string' ? code : 'INTERNAL_ERROR', stageError.message, {details: {...details, stageAttempts}});
    await onProgress(job);
    throw Object.assign(stageError, {job});
  }
};
