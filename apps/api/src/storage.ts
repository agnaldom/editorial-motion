import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export interface StorageDriver {
  put(key: string, data: Buffer | string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  resolvePath(key: string): string;
}

const safeJoin = (root: string, key: string): string => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/.test(key)) throw new Error(`Invalid storage key: ${key}`);
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
  return resolved;
};

export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root = process.env.LOCAL_STORAGE_PATH ?? path.resolve(process.cwd(), 'data')) {}

  async put(key: string, data: Buffer | string): Promise<void> {
    const target = safeJoin(this.root, key);
    await mkdir(path.dirname(target), {recursive: true});
    await writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(safeJoin(this.root, key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await readFile(safeJoin(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  resolvePath(key: string): string {
    return safeJoin(this.root, key);
  }
}
