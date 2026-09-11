import {MemoryCache} from '@editorial-motion/shared';
import {Redis} from 'ioredis';

// Cache de visão sobrevive a restart com Redis (issue #125, SPEC §27); sem
// REDIS_URL cai no MemoryCache de processo (comportamento V1).
export type VisionCache = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
};

const VISION_CACHE_TTL_SECONDS = 24 * 60 * 60;

export class RedisVisionCache implements VisionCache {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {lazyConnect: false});
  }

  async get(key: string): Promise<string | undefined> {
    const value = await this.redis.get(key);
    return value ?? undefined;
  }

  async set(key: string, value: string): Promise<void> {
    await this.redis.set(key, value, 'EX', VISION_CACHE_TTL_SECONDS);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export const createVisionCache = (redisUrl: string | undefined): VisionCache => {
  if (redisUrl) return new RedisVisionCache(redisUrl);
  const memory = new MemoryCache<string>();
  return {
    get: async (key) => memory.get(key),
    set: async (key, value) => memory.set(key, value),
  };
};

// Singleton do processo (stages.ts); com Redis a conexão precisa ser fechada
// no shutdown/testes para não segurar o event loop.
let shared: VisionCache | null = null;

export const sharedVisionCache = (): VisionCache => (shared ??= createVisionCache(process.env.REDIS_URL));

export const closeSharedVisionCache = async (): Promise<void> => {
  if (shared instanceof RedisVisionCache) await shared.close();
  shared = null;
};
