import type {JobStage} from './jobs';

export type ErrorResponse = {
  code: string;
  message: string;
  stage?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type StageMetric = {count: number; failures: number; elapsedMs: number};

// SPEC §31 — nomes canônicos por estágio; estágios fora da lista usam a métrica genérica com label.
const stageMetricNames: Partial<Record<JobStage, string>> = {
  analyzing: 'vision_stage_duration_seconds',
  segmenting: 'segmentation_stage_duration_seconds',
  inpainting: 'inpainting_stage_duration_seconds',
  planning_motion: 'motion_plan_duration_seconds',
  rendering: 'remotion_render_duration_seconds',
};

const metricPair = (name: string, count: number, seconds: number): string[] => [
  `# TYPE ${name} summary`,
  `${name}_count ${count}`,
  `${name}_sum ${seconds.toFixed(3)}`,
];

export class RenderMetrics {
  private jobsTotal = 0;
  private jobsFailed = 0;
  private jobDurationCount = 0;
  private jobDurationSeconds = 0;
  private llmTokensInput = 0;
  private llmTokensOutput = 0;
  private readonly stages = new Map<string, StageMetric>();

  record(stage: string, elapsedMs: number, failed = false): void {
    const current = this.stages.get(stage) ?? {count: 0, failures: 0, elapsedMs: 0};
    current.count += 1;
    current.failures += failed ? 1 : 0;
    current.elapsedMs += elapsedMs;
    this.stages.set(stage, current);
  }

  recordJob(durationMs: number, failed: boolean): void {
    this.jobsTotal += 1;
    this.jobsFailed += failed ? 1 : 0;
    this.jobDurationCount += 1;
    this.jobDurationSeconds += durationMs / 1000;
  }

  recordLlmTokens(inputTokens: number, outputTokens: number): void {
    this.llmTokensInput += inputTokens;
    this.llmTokensOutput += outputTokens;
  }

  snapshot(): Record<string, StageMetric> {
    return Object.fromEntries([...this.stages.entries()].map(([stage, metric]) => [stage, {...metric}]));
  }

  // Exposition no formato de texto do Prometheus (0.0.4), sem dependências externas.
  prometheus(): string {
    const lines: string[] = [
      '# HELP render_jobs_total Total render jobs.',
      '# TYPE render_jobs_total counter',
      `render_jobs_total ${this.jobsTotal}`,
      '# TYPE render_jobs_failed_total counter',
      `render_jobs_failed_total ${this.jobsFailed}`,
      ...metricPair('render_job_duration_seconds', this.jobDurationCount, this.jobDurationSeconds),
      '# TYPE llm_tokens_input_total counter',
      `llm_tokens_input_total ${this.llmTokensInput}`,
      '# TYPE llm_tokens_output_total counter',
      `llm_tokens_output_total ${this.llmTokensOutput}`,
    ];
    for (const [stage, metric] of this.stages.entries()) {
      const name = stageMetricNames[stage as JobStage];
      if (name) {
        lines.push(...metricPair(name, metric.count, metric.elapsedMs / 1000));
      } else {
        const label = `{stage="${stage}"}`;
        lines.push(...metricPair('pipeline_stage_duration_seconds', metric.count, metric.elapsedMs / 1000)
          .map((line) => line.replace('_count ', `_count${label} `).replace('_sum ', `_sum${label} `)));
      }
      lines.push(`pipeline_stage_failures_total{stage="${stage}"} ${metric.failures}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

// ponytail: singleton em memória no processo; upgrade: exporter OTel/Prometheus real.
export const renderMetrics = new RenderMetrics();

export const actionableError = (error: ErrorResponse): ErrorResponse => ({
  ...error,
  message: error.message.trim() || 'The render job could not be completed.',
});
