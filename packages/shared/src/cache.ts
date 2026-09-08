import {createHash} from 'node:crypto';

export type ProviderVersions = {
  visionModel: string;
  segmentationModel: string;
  inpaintingModel: string;
};

const stableJson = (value: Record<string, string>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));

export const sourceHash = (image: Uint8Array): string => createHash('sha256').update(image).digest('hex');

export const analysisCacheKey = (image: Uint8Array, versions: ProviderVersions): string => {
  const payload = stableJson({
    image: sourceHash(image),
    visionModel: versions.visionModel,
    segmentationModel: versions.segmentationModel,
    inpaintingModel: versions.inpaintingModel,
  });
  return `analysis:${createHash('sha256').update(payload).digest('hex')}`;
};

export class MemoryCache<T> {
  private readonly values = new Map<string, T>();

  get(key: string): T | undefined { return this.values.get(key); }
  set(key: string, value: T): void { this.values.set(key, value); }
  has(key: string): boolean { return this.values.has(key); }
  clear(): void { this.values.clear(); }
}
