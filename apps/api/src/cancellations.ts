// Cancelamento cooperativo (issue #124): a API marca a flag; o pipeline
// verifica entre stages e o worker antes de iniciar. Stage em andamento
// completa (o render filho segue até o close do processo — limitação V1).
export class CancellationRegistry {
  private readonly flags = new Set<string>();

  request(jobId: string): void {
    this.flags.add(jobId);
  }

  isRequested(jobId: string): boolean {
    return this.flags.has(jobId);
  }
}
