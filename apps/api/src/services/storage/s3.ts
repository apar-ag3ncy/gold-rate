import { assertSafeKey, type SaveResult, type StorageAdapter } from './types';

export interface S3Options { bucket: string; region: string; prefix?: string; publicBaseUrl?: string }

/**
 * Production driver (stub). Configured via env (S3_BUCKET, S3_REGION, S3_PREFIX, S3_PUBLIC_BASE_URL);
 * uploads are wired in Phase 7 together with the deployment guide. Until then STORAGE_DRIVER=local.
 */
export class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;
  constructor(private readonly opts: S3Options) {}

  private objectKey(key: string) {
    assertSafeKey(key);
    const prefix = (this.opts.prefix ?? '').replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${key}` : key;
  }

  publicUrl(key: string) {
    const base = (this.opts.publicBaseUrl ?? `https://${this.opts.bucket}.s3.${this.opts.region}.amazonaws.com`).replace(/\/+$/, '');
    return `${base}/${this.objectKey(key)}`;
  }

  async exists(_key: string): Promise<boolean> {
    throw new Error('S3 storage is not implemented yet (Phase 7). Use STORAGE_DRIVER=local.');
  }

  async save(_buffer: Buffer, _key: string, _contentType: string): Promise<SaveResult> {
    throw new Error('S3 storage is not implemented yet (Phase 7). Use STORAGE_DRIVER=local.');
  }
}
