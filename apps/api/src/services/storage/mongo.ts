import { Media } from '../../models/Media';
import { assertSafeKey, type SaveResult, type StorageAdapter } from './types';

/** Serverless driver: images live in MongoDB and are served by the API at /media/<key> (no disk needed). */
export class MongoStorage implements StorageAdapter {
  readonly driver = 'mongo' as const;
  constructor(private readonly baseUrl: string) {}

  publicUrl(key: string) { return `${this.baseUrl}/media/${key}`; }

  async exists(key: string) {
    assertSafeKey(key);
    return !!(await Media.exists({ key }));
  }

  /** Writes once: a duplicate key keeps the existing bytes (a sent rate's image must stay byte-identical). */
  async save(buffer: Buffer, key: string, contentType: string): Promise<SaveResult> {
    assertSafeKey(key);
    try {
      await Media.create({ key, contentType, data: buffer, size: buffer.length });
      return { key, url: this.publicUrl(key), existed: false };
    } catch (e: any) {
      if (e?.code === 11000) return { key, url: this.publicUrl(key), existed: true };
      throw e;
    }
  }

  async get(key: string) {
    assertSafeKey(key);
    const doc = await Media.findOne({ key });          // not lean(): Mongoose hands back a real Buffer (lean() gives a BSON Binary)
    if (!doc) return null;
    const raw: any = doc.data;
    const data: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw?.buffer ?? raw);
    return { contentType: doc.contentType, data, size: data.length };
  }
}
