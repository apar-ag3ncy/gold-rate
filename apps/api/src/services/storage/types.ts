export interface SaveResult { key: string; url: string; existed: boolean }

/** Where rendered creatives live. The URL must be publicly fetchable (Instagram downloads it in Phase 4). */
export interface StorageAdapter {
  readonly driver: 'local' | 's3' | 'cloudinary';
  /** Writes once. If the key already exists the existing object is kept (keys embed a content hash, so it is identical). */
  save(buffer: Buffer, key: string, contentType: string): Promise<SaveResult>;
  exists(key: string): Promise<boolean>;
  publicUrl(key: string): string;
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Unsafe storage key: ${key}`);
}
