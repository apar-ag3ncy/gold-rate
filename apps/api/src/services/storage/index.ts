import crypto from 'node:crypto';
import type { Config } from '../../config';
import { LocalStorage } from './local';
import { S3Storage } from './s3';
import { CloudinaryStorage } from './cloudinary';
import type { StorageAdapter } from './types';

export type { StorageAdapter, SaveResult } from './types';

export function createStorage(cfg: Config): StorageAdapter {
  if (cfg.STORAGE_DRIVER === 'cloudinary') {
    return new CloudinaryStorage({ cloudName: cfg.CLOUDINARY_CLOUD_NAME!, apiKey: cfg.CLOUDINARY_API_KEY!, apiSecret: cfg.CLOUDINARY_API_SECRET!, folder: cfg.CLOUDINARY_FOLDER });
  }
  if (cfg.STORAGE_DRIVER === 's3') {
    return new S3Storage({ bucket: cfg.S3_BUCKET!, region: cfg.S3_REGION!, prefix: cfg.S3_PREFIX, publicBaseUrl: cfg.S3_PUBLIC_BASE_URL });
  }
  return new LocalStorage(cfg.MEDIA_DIR, cfg.MEDIA_BASE_URL);
}

export const contentHash = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

/**
 * "creative/2026-09-18/feed-2026-09-18-<hash>.jpg" – date + content hash in the name, so a re-render with
 * different values gets a new file and an already-sent image is never overwritten.
 */
export function creativeKey(prefix: 'creative' | 'preview', date: string, kind: 'feed' | 'story', buf: Buffer) {
  return `${prefix}/${date}/${kind}-${date}-${contentHash(buf)}.jpg`;
}
