import type {RenderJob} from './jobs';

export interface JobRepository {
  get(id: string): Promise<RenderJob | undefined>;
  save(job: RenderJob): Promise<void>;
}

export class MemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, RenderJob>();

  async get(id: string): Promise<RenderJob | undefined> {
    return this.jobs.get(id);
  }

  async save(job: RenderJob): Promise<void> {
    this.jobs.set(job.id, {...job});
  }
}

// ponytail: in-process sequential queue, one worker (SPEC §26); swap for BullMQ+Redis when the Docker infra lands (issue #71).
export class LocalJobQueue {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly handler: (jobId: string) => Promise<void>) {}

  enqueue(jobId: string): void {
    if (this.closed) throw new Error('Queue is closed');
    this.tail = this.tail.then(() => this.handler(jobId)).catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }
}
