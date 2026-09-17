import type { Config } from '../../config';
import { logger } from '../../lib/logger';

/**
 * Minimal Graph API client (Instagram + WhatsApp Cloud API share the same host).
 * - one place for the API version (META_GRAPH_VERSION)
 * - typed errors: retryable (rate limits, 5xx, network) vs permanent (bad token, bad params, policy)
 * - tokens are passed per call and never logged
 */
export class MetaApiError extends Error {
  constructor(message: string, public readonly opts: { status?: number; code?: number; subcode?: number; type?: string; retryable: boolean; fbtraceId?: string }) {
    super(message);
    this.name = 'MetaApiError';
  }
  get retryable() { return this.opts.retryable; }
  get code() { return this.opts.code; }
}
export class PublishError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly code?: number) { super(message); this.name = 'PublishError'; }
}
export const isRetryable = (e: unknown) => (e instanceof MetaApiError || e instanceof PublishError) ? e.retryable : true;

// Graph error codes that are worth retrying (throttling / transient). Everything else is treated as permanent.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80007, 130429, 131056, 131048, 131000]);
const RETRYABLE_SUBCODES = new Set([2207001, 2207003, 2207051]);

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class MetaClient {
  constructor(private readonly cfg: Pick<Config, 'META_GRAPH_VERSION'>, private readonly fetchFn: FetchLike = (u, i) => fetch(u, i)) {}
  get version() { return this.cfg.META_GRAPH_VERSION; }
  url(path: string) { return `https://graph.facebook.com/${this.version}/${path.replace(/^\//, '')}`; }

  async get<T = any>(path: string, params: Record<string, string | number | undefined>, token: string): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return this.request<T>('GET', `${this.url(path)}?${q}`, token);
  }
  async post<T = any>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
    return this.request<T>('POST', this.url(path), token, body);
  }

  private async request<T>(method: 'GET' | 'POST', url: string, token: string, body?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      throw new MetaApiError(`Network error calling Meta: ${e?.message ?? e}`, { retryable: true });
    }
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
    if (!res.ok || data?.error) {
      const err = data?.error ?? {};
      const code = Number(err.code ?? 0), subcode = Number(err.error_subcode ?? 0);
      const retryable = res.status >= 500 || RETRYABLE_CODES.has(code) || RETRYABLE_SUBCODES.has(subcode) || res.status === 429;
      const msg = err.error_user_msg || err.message || `HTTP ${res.status}`;
      logger.warn({ status: res.status, code, subcode, type: err.type, fbtrace: err.fbtrace_id, url: url.replace(/access_token=[^&]+/, 'access_token=***') }, `Meta API error: ${msg}`);
      throw new MetaApiError(`${msg}${code ? ` (code ${code}${subcode ? `/${subcode}` : ''})` : ''}`, { status: res.status, code, subcode, type: err.type, retryable, fbtraceId: err.fbtrace_id });
    }
    return data as T;
  }
}
