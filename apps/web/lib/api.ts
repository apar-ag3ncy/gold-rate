'use client';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

/** Identical GETs issued while one is still in flight share the same request (React StrictMode double effects, sibling components). */
const inflight = new Map<string, Promise<unknown>>();

export function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (method !== 'GET') return request<T>(path, opts);
  const key = path;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = request<T>(path, opts).finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

async function request<T>(path: string, opts: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chheda-web' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
    });
  } catch { throw new ApiError(0, 'Could not reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, friendly(res.status, data.error), data.details);
  return data as T;
}

const friendly = (status: number, msg?: string) =>
  msg ?? ({ 401: 'Not signed in – the server needs AUTO_LOGIN_EMAIL set to an existing admin user.', 403: 'You do not have permission to do this.', 404: 'Not found.', 409: 'This was already done.', 429: 'Too many requests – please wait a moment.', 500: 'Something went wrong on the server. It has been logged.' } as Record<number, string>)[status] ?? 'Request failed';

/** ₹ Indian grouping, exact digits (max 2 decimals as entered). */
export const inr = (n?: number | null) =>
  n == null ? '–' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const perGram = (n?: number | null) => (n == null ? '–' : `${inr(n)}/g`);

export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
/** "18 Sept 2026, 07:00 IST" */
export const fmtDateTime = (d?: string | Date | null) =>
  d ? `${new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} IST` : '–';
export const fmtTime = (d?: string | Date | null) =>
  d ? `${new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })} IST` : '–';

export const channelLabel: Record<string, string> = {
  ig_feed: 'Instagram Feed', ig_story: 'Instagram Story', wa_customers: 'WhatsApp customers', wa_admin: 'Test send (admin)',
  ig_broadcast_manual: 'Instagram Broadcast (staff)', wa_channel_manual: 'WhatsApp Channel (staff)', wa_community_manual: 'WhatsApp Community (staff)',
  wa_keyword: 'WhatsApp keyword reply', ig_keyword: 'Instagram keyword reply',
};
export const triggerLabel: Record<string, string> = { cron: 'Scheduled', send_now: 'Send Now', test: 'Test', keyword: 'Keyword' };
