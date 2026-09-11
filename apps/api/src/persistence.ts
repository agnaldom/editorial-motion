import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {RenderJob} from './jobs';
import {failJob} from './jobs';
import type {JobRepository} from './repository';
import type {StorageDriver} from './storage';

// SPEC §25 — RenderArtifact: metadados mínimos por artefato do pipeline.
export type RenderArtifactType = 'source' | 'mask' | 'layer' | 'background' | 'analysis' | 'motion-plan' | 'video' | 'debug';

export type RenderArtifact = {
  id: string;
  jobId: string;
  type: RenderArtifactType;
  key: string;
  metadata?: Record<string, unknown>;
};

export interface ArtifactRepository {
  record(artifact: Omit<RenderArtifact, 'id'>): Promise<void>;
}

// Classifica a chave do storage no tipo do §25; jobId vem do padrão jobs/<id>/...
export const classifyArtifactKey = (key: string): {jobId: string | null; type: RenderArtifactType} => {
  const match = /^jobs\/([^/]+)\/(.*)$/.exec(key);
  const jobId = match?.[1] ?? null;
  const rest = match?.[2] ?? key;
  let type: RenderArtifactType = 'debug';
  if (/^input\//.test(rest)) type = 'source';
  else if (/^masks\//.test(rest)) type = 'mask';
  else if (/^layers\//.test(rest)) type = 'layer';
  else if (/^background\//.test(rest)) type = 'background';
  else if (/^analysis\//.test(rest)) type = 'analysis';
  else if (/^motion\//.test(rest)) type = 'motion-plan';
  else if (/^output\/.*\.mp4$/.test(rest)) type = 'video';
  return {jobId, type};
};

const ensureSchemaSql = `
CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS render_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export class SqlJobRepository implements JobRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({connectionString: databaseUrl, max: 5});
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(ensureSchemaSql);
  }

  async get(id: string): Promise<RenderJob | undefined> {
    const result = await this.pool.query('SELECT payload FROM render_jobs WHERE id = $1', [id]);
    return result.rows[0] ? (result.rows[0].payload as RenderJob) : undefined;
  }

  async save(job: RenderJob): Promise<void> {
    await this.pool.query(
      'INSERT INTO render_jobs (id, payload, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET payload = $2, updated_at = now()',
      [job.id, JSON.stringify(job)],
    );
  }

  async activeJobs(): Promise<RenderJob[]> {
    const result = await this.pool.query(
      "SELECT payload FROM render_jobs WHERE payload->>'status' IN ('queued', 'processing')",
    );
    return result.rows.map((row: {payload: RenderJob}) => row.payload);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class SqlArtifactRepository implements ArtifactRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({connectionString: databaseUrl, max: 5});
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(ensureSchemaSql);
  }

  async record(artifact: Omit<RenderArtifact, 'id'>): Promise<void> {
    await this.pool.query(
      'INSERT INTO render_artifacts (id, job_id, type, key, metadata) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), artifact.jobId, artifact.type, artifact.key, artifact.metadata ? JSON.stringify(artifact.metadata) : null],
    );
  }

  async list(jobId: string): Promise<RenderArtifact[]> {
    const result = await this.pool.query('SELECT * FROM render_artifacts WHERE job_id = $1 ORDER BY created_at', [jobId]);
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      jobId: row.job_id,
      type: row.type,
      key: row.key,
      metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    })) as RenderArtifact[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Wrap de StorageDriver que registra metadados de cada put (SPEC §25) sem tocar nos stages.
export class AuditedStorageDriver implements StorageDriver {
  constructor(
    private readonly inner: StorageDriver,
    private readonly artifacts: ArtifactRepository,
  ) {}

  async put(key: string, data: Buffer | string): Promise<void> {
    await this.inner.put(key, data);
    const {jobId, type} = classifyArtifactKey(key);
    if (jobId) {
      await this.artifacts.record({jobId, type, key, metadata: {bytes: Buffer.byteLength(data)}}).catch(() => undefined);
    }
  }

  get(key: string): Promise<Buffer> {
    return this.inner.get(key);
  }

  exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  resolvePath(key: string): string {
    return this.inner.resolvePath(key);
  }
}

// Boot reconciliation (issue #125): sem órfãos após restart — queued retoma,
// processing falha de forma coerente e retryable (contexto do pipeline se perdeu).
export const reconcileInterruptedJobs = async (
  repository: JobRepository,
  requeue: (jobId: string) => void,
  activeJobs?: () => Promise<RenderJob[]>,
): Promise<{requeued: number; interrupted: number}> => {
  const jobs = activeJobs ? await activeJobs() : [];
  let requeued = 0;
  let interrupted = 0;
  for (const job of jobs) {
    if (job.status === 'queued') {
      requeue(job.id);
      requeued += 1;
    } else {
      await repository.save(failJob(job, 'INTERRUPTED', 'API restarted while the job was processing', {retryable: true}));
      interrupted += 1;
    }
  }
  return {requeued, interrupted};
};
