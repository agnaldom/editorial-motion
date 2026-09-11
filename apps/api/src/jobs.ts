export const jobStages = [
  'queued', 'validating', 'normalizing', 'analyzing', 'detecting', 'segmenting',
  'extracting_layers', 'inpainting', 'planning_motion', 'validating_plan',
  'rendering', 'verifying_output', 'completed', 'failed',
] as const;

export type JobStage = typeof jobStages[number];
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type RenderJob = {
  id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  // Progresso 0–100 dentro do estágio atual (só rendering emite hoje; demais ficam em 0/100).
  stageProgress: number;
  attempt: number;
  prompt?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  inputAssetKey?: string;
  outputAssetKey?: string;
  outputFileName?: string;
  requestId?: string;
  error?: {code: string; message: string; retryable: boolean; stage?: JobStage; details?: Record<string, unknown>};
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type RenderJobParams = {
  prompt: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  inputAssetKey?: string;
  outputFileName?: string;
  requestId?: string;
};

const defaultParams: RenderJobParams = {prompt: '', durationSeconds: 8, width: 2560, height: 1440, fps: 30};

// Pesos por estágio: rendering domina o tempo de parede (~90%), então ocupa a
// maior fatia da barra de progresso; os demais estágios são rápidos (ms–s).
const stageWeights: Record<JobStage, number> = {
  queued: 0,
  validating: 1,
  normalizing: 1,
  analyzing: 2,
  detecting: 1,
  segmenting: 1,
  extracting_layers: 2,
  inpainting: 1,
  planning_motion: 2,
  validating_plan: 1,
  rendering: 40,
  verifying_output: 2,
  completed: 0,
  failed: 0,
};

const totalStageWeight = Object.values(stageWeights).reduce((sum, weight) => sum + weight, 0);

// Progresso (0–100) acumulado ao ENTRAR no estágio — a soma dos pesos anteriores.
export const stageBaseProgress = (stage: JobStage): number => {
  const index = jobStages.indexOf(stage);
  let before = 0;
  for (let i = 0; i < index; i += 1) before += stageWeights[jobStages[i]];
  return Math.round((before / totalStageWeight) * 100);
};

const retryableStages = new Set<JobStage>(['analyzing', 'detecting', 'segmenting', 'inpainting', 'planning_motion', 'rendering']);

export const createRenderJob = (id: string, params: RenderJobParams = defaultParams, now = new Date().toISOString()): RenderJob => ({
  ...params, id, status: 'queued', stage: 'queued', progress: 0, stageProgress: 0, attempt: 0, createdAt: now, updatedAt: now,
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
    progress: completed ? 100 : Math.max(job.progress, stageBaseProgress(stage)),
    stageProgress: 0,
    updatedAt: now,
    completedAt: completed ? now : undefined,
  };
};

export const failJob = (
  job: RenderJob,
  code: string,
  message: string,
  options: {retryable?: boolean; details?: Record<string, unknown>; now?: string} = {},
): RenderJob => ({
  ...job,
  status: 'failed',
  error: {
    code,
    message,
    retryable: options.retryable ?? retryableStages.has(job.stage),
    stage: job.stage,
    ...(options.details ? {details: options.details} : {}),
  },
  updatedAt: options.now ?? new Date().toISOString(),
});

export const retryJob = (job: RenderJob, now = new Date().toISOString()): RenderJob => {
  if (job.status !== 'failed' || !job.error?.retryable) throw new Error('Job is not retryable');
  // Reset para 'queued': o pipeline recomeça do primeiro estágio e advanceJob
  // rejeita retrocesso a partir do estágio onde falhou.
  return {...job, status: 'processing', stage: 'queued', progress: 0, stageProgress: 0, attempt: job.attempt + 1, error: undefined, updatedAt: now};
};

// Cancelamento cooperativo (issue #124): não-retryable e sem métrica de falha de pipeline.
export const cancelJob = (job: RenderJob, now = new Date().toISOString()): RenderJob => ({
  ...job,
  status: 'cancelled',
  error: {code: 'CANCELLED', message: 'Render job cancelled by user', retryable: false, stage: job.stage},
  updatedAt: now,
});
