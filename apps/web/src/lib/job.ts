import {z} from 'zod';

export const jobOutputSchema = z.object({
  fileName: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  durationSeconds: z.number(),
});

export const jobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const jobResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  stage: z.string(),
  progress: z.number(),
  stageProgress: z.number(),
  output: jobOutputSchema.nullable(),
  error: jobErrorSchema.nullable(),
});

export type JobResponse = z.infer<typeof jobResponseSchema>;

// Labels de usuário para os estágios visíveis do pipeline (SPEC §9).
export const stageLabels: ReadonlyArray<{stage: string; label: string}> = [
  {stage: 'analyzing', label: 'Analyzing image'},
  {stage: 'detecting', label: 'Detecting elements'},
  {stage: 'segmenting', label: 'Segmenting elements'},
  {stage: 'extracting_layers', label: 'Extracting layers'},
  {stage: 'inpainting', label: 'Cleaning background'},
  {stage: 'planning_motion', label: 'Planning motion'},
  {stage: 'rendering', label: 'Rendering video'},
];

export const stageIndex = (stage: string): number => stageLabels.findIndex((s) => s.stage === stage);

export const isActive = (status: JobResponse['status']): boolean => status === 'queued' || status === 'processing';

export const fetchJob = async (jobId: string): Promise<JobResponse> => {
  const response = await fetch(`/api/v1/renders/${jobId}`);
  if (!response.ok) throw new Error(`Failed to fetch job status (${response.status})`);
  return jobResponseSchema.parse(await response.json());
};

export const retryJobRequest = async (jobId: string): Promise<JobResponse> => {
  const response = await fetch(`/api/v1/renders/${jobId}/retry`, {method: 'POST'});
  if (!response.ok) throw new Error(`Failed to retry render (${response.status})`);
  return fetchJob(jobId);
};
