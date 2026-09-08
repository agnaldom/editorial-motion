export type ErrorResponse = {
  code: string;
  message: string;
  stage?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type StageMetric = {count: number; failures: number; elapsedMs: number};

export class RenderMetrics {
  private readonly stages = new Map<string, StageMetric>();

  record(stage: string, elapsedMs: number, failed = false): void {
    const current = this.stages.get(stage) ?? {count: 0, failures: 0, elapsedMs: 0};
    current.count += 1;
    current.failures += failed ? 1 : 0;
    current.elapsedMs += elapsedMs;
    this.stages.set(stage, current);
  }

  snapshot(): Record<string, StageMetric> {
    return Object.fromEntries([...this.stages.entries()].map(([stage, metric]) => [stage, {...metric}]));
  }
}

export const actionableError = (error: ErrorResponse): ErrorResponse => ({
  ...error,
  message: error.message.trim() || 'The render job could not be completed.',
});
