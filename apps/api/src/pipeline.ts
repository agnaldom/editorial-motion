import {advanceJob, failJob, type JobStage, type RenderJob} from './jobs';

export type PipelineContext = {
  image: Buffer;
  prompt: string;
  artifacts: Record<string, unknown>;
};

export type PipelineStage = Exclude<JobStage, 'queued' | 'completed' | 'failed'>;
export type StageHandler = (context: PipelineContext) => Promise<PipelineContext>;
export type PipelineProgress = (job: RenderJob) => void;

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
      onProgress(job);
      const handler = handlers[stage];
      if (handler) context = await handler(context);
    }
    job = advanceJob(job, 'completed');
    onProgress(job);
    return {job, context};
  } catch (error) {
    job = failJob(job, 'PIPELINE_STAGE_FAILED', error instanceof Error ? error.message : 'Pipeline stage failed');
    onProgress(job);
    throw Object.assign(error instanceof Error ? error : new Error('Pipeline stage failed'), {job});
  }
};
