import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafeKey, type SaveResult, type StorageAdapter } from './types';

/** Dev/self-hosted driver: files under MEDIA_DIR, served by the API at /media/<key>. */
export class LocalStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  constructor(private readonly dir: string, private readonly baseUrl: string) {}

  publicUrl(key: string) { return `${this.baseUrl}/media/${key}`; }

  private filePath(key: string) {
    assertSafeKey(key);
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Storage key escapes media dir');
    return p;
  }

  async exists(key: string) {
    return fs.access(this.filePath(key)).then(() => true, () => false);
  }

  async save(buffer: Buffer, key: string, _contentType: string): Promise<SaveResult> {
    const p = this.filePath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    try {
      // 'wx' = create only; never overwrite an existing file (a sent rate's image must stay byte-identical).
      await fs.writeFile(p, buffer, { flag: 'wx' });
      return { key, url: this.publicUrl(key), existed: false };
    } catch (e: any) {
      if (e?.code === 'EEXIST') return { key, url: this.publicUrl(key), existed: true };
      throw e;
    }
  }
}
