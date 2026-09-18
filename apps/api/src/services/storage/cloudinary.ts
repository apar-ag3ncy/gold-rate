import crypto from 'node:crypto';
import { assertSafeKey, type SaveResult, type StorageAdapter } from './types';

export interface CloudinaryOptions { cloudName: string; apiKey: string; apiSecret: string; folder?: string; fetchFn?: (url: string, init?: RequestInit) => Promise<Response> }

/**
 * Production adapter: signed uploads to Cloudinary's REST API (no SDK), one folder per month,
 * overwrite=false so a sent day's image is never replaced (same public_id → existing asset is returned), CDN URL returned.
 * Keys look like "creative/2026-09-18/feed-2026-09-18-<hash>.jpg" → public_id "<folder>/2026-09/feed-2026-09-18-<hash>".
 */
export class CloudinaryStorage implements StorageAdapter {
  readonly driver = 'cloudinary' as const;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  constructor(private readonly o: CloudinaryOptions) { this.fetchFn = o.fetchFn ?? ((u, i) => fetch(u, i)); }

  publicId(key: string) {
    assertSafeKey(key);
    const parts = key.split('/');                       // [prefix, YYYY-MM-DD, file.jpg]
    const date = parts.length >= 3 ? parts[1] : 'misc';
    const file = parts[parts.length - 1].replace(/\.[a-z0-9]+$/i, '');
    const root = (this.o.folder ?? 'chheda').replace(/^\/+|\/+$/g, '');
    return `${root}/${parts[0]}/${date.slice(0, 7)}/${file}`;
  }
  publicUrl(key: string) { return `https://res.cloudinary.com/${this.o.cloudName}/image/upload/${this.publicId(key)}.jpg`; }

  /** Signature per Cloudinary docs: sha1 of "k=v&k=v…" (sorted, excluding file/api_key/resource_type) + api_secret. */
  sign(params: Record<string, string | number | boolean>) {
    const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    return crypto.createHash('sha1').update(toSign + this.o.apiSecret).digest('hex');
  }

  async exists(key: string) {
    const res = await this.fetchFn(`https://api.cloudinary.com/v1_1/${this.o.cloudName}/resources/image/upload/${encodeURIComponent(this.publicId(key))}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${this.o.apiKey}:${this.o.apiSecret}`).toString('base64')}` },
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Cloudinary lookup failed: HTTP ${res.status}`);
    return true;
  }

  async save(buffer: Buffer, key: string, contentType: string): Promise<SaveResult> {
    const public_id = this.publicId(key);
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { public_id, timestamp, overwrite: false, unique_filename: false, invalidate: false };
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.set(k, String(v));
    form.set('api_key', this.o.apiKey);
    form.set('signature', this.sign(params));
    form.set('file', new Blob([new Uint8Array(buffer)], { type: contentType }), key.split('/').pop());
    const res = await this.fetchFn(`https://api.cloudinary.com/v1_1/${this.o.cloudName}/image/upload`, { method: 'POST', body: form });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Cloudinary upload failed: ${data?.error?.message ?? `HTTP ${res.status}`}`);
    const url: string = data.secure_url ?? this.publicUrl(key);
    return { key, url, existed: !!data.existing };
  }
}
