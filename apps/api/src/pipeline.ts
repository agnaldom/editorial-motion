import {advanceJob, failJob, type JobStage, type RenderJob} from './jobs';

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
): Promise<{job: RenderJob; context: PipelineContext}> => {
  let job = initialJob;
  let context = initialContext;
  try {
    for (const stage of stages) {
      job = advanceJob(job, stage);
      await onProgress(job);
      const handler = handlers[stage];
      if (handler) context = await handler(context);
    }
    job = advanceJob(job, 'completed');
    await onProgress(job);
    return {job, context};
  } catch (error) {
    const stageError = error instanceof Error ? error : new Error('Pipeline stage failed');
    const code = (stageError as unknown as {code?: unknown}).code;
    job = failJob(job, typeof code === 'string' ? code : 'PIPELINE_STAGE_FAILED', stageError.message);
    await onProgress(job);
    throw Object.assign(stageError, {job});
  }
};
