export const jobStages = [
  'queued', 'validating', 'normalizing', 'analyzing', 'detecting', 'segmenting',
  'extracting_layers', 'inpainting', 'planning_motion', 'validating_plan',
  'rendering', 'verifying_output', 'completed', 'failed',
] as const;

export type JobStage = typeof jobStages[number];
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type RenderJob = {
  id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  attempt: number;
  error?: {code: string; message: string; retryable: boolean};
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const retryableStages = new Set<JobStage>(['analyzing', 'detecting', 'segmenting', 'inpainting', 'planning_motion', 'rendering']);

export const createRenderJob = (id: string, now = new Date().toISOString()): RenderJob => ({
  id, status: 'queued', stage: 'queued', progress: 0, attempt: 0, createdAt: now, updatedAt: now,
});

export const advanceJob = (job: RenderJob, stage: JobStage, now = new Date().toISOString()): RenderJob => {
  if (job.status === 'completed' || job.status === 'failed') throw new Error(`Cannot advance a ${job.status} job`);
  const currentIndex = jobStages.indexOf(job.stage);
  const nextIndex = jobStages.indexOf(stage);
  if (stage !== 'failed' && nextIndex < currentIndex) throw new Error(`Invalid transition: ${job.stage} -> ${stage}`);
  const completed = stage === 'completed';
  return {
    ...job,
    status: completed ? 'completed' : stage === 'queued' ? 'queued' : 'processing',
    stage,
    progress: completed ? 100 : Math.max(job.progress, Math.round((nextIndex / (jobStages.length - 2)) * 100)),
    updatedAt: now,
    completedAt: completed ? now : undefined,
  };
};

export const failJob = (job: RenderJob, code: string, message: string, retryable = retryableStages.has(job.stage), now = new Date().toISOString()): RenderJob => ({
  ...job, status: 'failed', error: {code, message, retryable}, updatedAt: now,
});

export const retryJob = (job: RenderJob, now = new Date().toISOString()): RenderJob => {
  if (job.status !== 'failed' || !job.error?.retryable) throw new Error('Job is not retryable');
  return {...job, status: 'processing', attempt: job.attempt + 1, error: undefined, updatedAt: now};
};
