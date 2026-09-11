import {Redis} from 'ioredis';

// Fila durável em Redis (issue #125, SPEC §26): pending → processing via
// BLMOVE; restart re-enfileira o que estava em processamento. Interface igual
// ao LocalJobQueue ({enqueue, close}) — swap transparente.
// ponytail: duas conexões porque comando bloqueante serializa a conexão —
// o enqueue precisa acordar o BLMOVE da conexão de consume.
export class RedisJobQueue {
  private readonly blocking: Redis;
  private readonly commands: Redis;
  private stopped = false;
  private closed = false;
  private readonly loop: Promise<void>;

  constructor(
    private readonly handler: (jobId: string) => Promise<void>,
    redisUrl: string,
    private readonly keys = {pending: 'queue:pending', processing: 'queue:processing'},
  ) {
    this.blocking = new Redis(redisUrl, {maxRetriesPerRequest: null});
    this.commands = new Redis(redisUrl);
    this.loop = this.consume();
  }

  enqueue(jobId: string): void {
    void this.commands.lpush(this.keys.pending, jobId);
  }

  // Boot recovery: jobs que estavam sendo processados quando a API caiu voltam para a fila.
  async recover(): Promise<number> {
    const stuck = await this.commands.lrange(this.keys.processing, 0, -1);
    if (stuck.length > 0) await this.commands.rpush(this.keys.pending, ...stuck);
    await this.commands.del(this.keys.processing);
    return stuck.length;
  }

  private async consume(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const popped = await this.blocking.blmove(this.keys.pending, this.keys.processing, 'RIGHT', 'LEFT', 1).catch(() => null);
      if (!popped) continue;
      await this.handler(popped).catch(() => undefined);
      await this.commands.lrem(this.keys.processing, 1, popped);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopped = true;
    // Desbloqueia o BLMOVE pendente e encerra as conexões.
    this.blocking.disconnect();
    await this.loop.catch(() => undefined);
    this.commands.disconnect();
  }
}
