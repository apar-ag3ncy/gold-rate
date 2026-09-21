import { IBJA_FETCH_TIMEOUT_MS, ibjaRateTimeToSession, ibjaDateToIso, isoToIbjaDate, istDate, perGramFromPer10g, type IbjaPer10g, type IbjaSession, type IbjaSnapshot } from '@chheda/shared';
import type { Config } from '../../config';
import { logger } from '../../lib/logger';
import { parseIbjaHomepage } from './parse';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface IbjaRateSource { readonly name: 'api' | 'website'; fetchRecent(now: Date): Promise<IbjaSnapshot[]> }

export class IbjaFetchError extends Error { constructor(message: string, public readonly retryable: boolean) { super(message); this.name = 'IbjaFetchError'; } }
/** Never let the API token travel in error text (alerts, DB rows, emails). */
export const scrubSecret = (msg: string, secret?: string) => (secret && secret.length > 3 ? msg.split(secret).join('[token]') : msg).slice(0, 300);
const withTimeout = (init?: RequestInit): RequestInit => ({ ...init, signal: AbortSignal.timeout(IBJA_FETCH_TIMEOUT_MS) });
/** IBJA only publishes for past/present IST days; anything later is a broken upstream row, never a rate. */
const notFuture = (rateDate: string, now: Date) => rateDate <= istDate(now);

const snap = (rateDate: string, session: IbjaSession, per10g: IbjaPer10g, source: 'api' | 'website', fetchedAt: Date): IbjaSnapshot =>
  ({ rateDate, session, per10g, perGram: perGramFromPer10g(per10g), source, fetchedAt: fetchedAt.toISOString() });

/**
 * Official IBJA Rates API (subscription): GET {base}/API/GoldRates/?ACCESS_TOKEN&START_DATE&END_DATE (dd/MM/yyyy).
 * Rows: { RateDate, RateTime: "12AM"|"6PM", Purity: "999", GoldRate: "153056", SilverRate }. 40 hits/day in production.
 */
export class IbjaApiSource implements IbjaRateSource {
  readonly name = 'api' as const;
  constructor(private readonly cfg: Pick<Config, 'IBJA_API_TOKEN' | 'IBJA_API_BASE'>, private readonly fetchFn: FetchLike = (u, i) => fetch(u, i)) {}
  async fetchRecent(now: Date): Promise<IbjaSnapshot[]> {
    if (!this.cfg.IBJA_API_TOKEN) throw new IbjaFetchError('IBJA_API_TOKEN is not configured', false);
    const end = istDate(now); const start = istDate(new Date(now.getTime() - 4 * 86_400_000));   // covers weekends + holidays
    const url = `${this.cfg.IBJA_API_BASE.replace(/\/+$/, '')}/API/GoldRates/?ACCESS_TOKEN=${encodeURIComponent(this.cfg.IBJA_API_TOKEN)}&START_DATE=${isoToIbjaDate(start)}&END_DATE=${isoToIbjaDate(end)}`;
    let res: Response;
    try { res = await this.fetchFn(url, withTimeout({ headers: { Accept: 'application/json' } })); } catch (e: any) { throw new IbjaFetchError(scrubSecret(`IBJA API unreachable: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e}`, this.cfg.IBJA_API_TOKEN), true); }
    if (!res.ok) throw new IbjaFetchError(`IBJA API HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const body: any = await res.json().catch(() => { throw new IbjaFetchError('IBJA API returned non-JSON', true); });
    // tolerate the documented array, a bare {status,message} object, or a {data:[…]} wrapper
    const rows: any[] | null = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : body && typeof body === 'object' && body.status ? [body] : null;
    if (!rows) throw new IbjaFetchError('IBJA API: unexpected response shape', false);
    const status = rows[0]?.status ? String(rows[0].status) : null;
    if (status) {
      const msg = String(rows[0].message ?? status);
      if (/No Record Found/i.test(msg)) return [];
      throw new IbjaFetchError(`IBJA API: ${msg}`, /hit limit/i.test(msg));      // token / date errors are permanent
    }
    const byKey = new Map<string, IbjaPer10g>();
    let dropped = 0;
    for (const r of rows) {
      try {
        const session = ibjaRateTimeToSession(String(r.RateTime ?? '')); const purity = String(r.Purity ?? '').trim();
        if (!session || !r.RateDate) { dropped++; continue; }
        const iso = ibjaDateToIso(String(r.RateDate));
        if (!notFuture(iso, now)) { dropped++; continue; }
        const key = `${iso}:${session}`;
        const p = byKey.get(key) ?? {};
        const gold = String(r.GoldRate ?? '').replace(/,/g, '').trim();
        if (/^\d+(\.\d+)?$/.test(gold) && Number(gold) > 0) (p as any)[purity] = gold; else dropped++;
        const silver = String(r.SilverRate ?? '').replace(/,/g, '').trim();
        if (/^\d+(\.\d+)?$/.test(silver) && Number(silver) > 0 && !p.silver999) p.silver999 = silver;
        byKey.set(key, p);
      } catch (e: any) { dropped++; logger.warn({ row: r, err: e?.message }, 'IBJA API row skipped'); }
    }
    const out: IbjaSnapshot[] = [];
    for (const [key, per10g] of byKey) {
      const [rateDate, session] = key.split(':') as [string, IbjaSession];
      try { if (per10g['999'] && per10g['916'] && per10g['750']) out.push(snap(rateDate, session, per10g, 'api', now)); }
      catch (e: any) { logger.warn({ key, err: e?.message }, 'IBJA API snapshot skipped'); }
    }
    if (rows.length > 0 && out.length === 0) throw new IbjaFetchError(`IBJA API: ${rows.length} rows but none matched the expected RateDate/RateTime/Purity format (${dropped} skipped) – the API format may have changed`, false);
    if (dropped) logger.warn({ dropped, kept: out.length }, 'IBJA API: some rows were skipped');
    return out.sort((a, b) => (a.rateDate === b.rateDate ? (a.session === 'PM' ? -1 : 1) : a.rateDate < b.rateDate ? 1 : -1));
  }
}

/** Fallback for the trial: the public ibjarates.com homepage (server-rendered). IBJA asks commercial users to subscribe to the API. */
export class IbjaWebsiteSource implements IbjaRateSource {
  readonly name = 'website' as const;
  constructor(private readonly url: string, private readonly fetchFn: FetchLike = (u, i) => fetch(u, i)) {}
  async fetchRecent(now: Date): Promise<IbjaSnapshot[]> {
    let res: Response;
    try { res = await this.fetchFn(this.url, withTimeout({ headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChhedaGoldRate/1.0)', Accept: 'text/html' } })); }
    catch (e: any) { throw new IbjaFetchError(`ibjarates.com unreachable: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e}`, true); }
    if (!res.ok) throw new IbjaFetchError(`ibjarates.com HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const html = (await res.text()).slice(0, 2_000_000);   // body cap: the page is ~160 KB
    let parsed; try { parsed = parseIbjaHomepage(html); } catch (e: any) { throw new IbjaFetchError(e?.message ?? 'parse failed', false); }
    const today = istDate(now);
    const out: IbjaSnapshot[] = [];
    for (const session of ['PM', 'AM'] as const) if (parsed.today[session]) out.push(snap(today, session, parsed.today[session]!, 'website', now));
    for (const h of parsed.history) if (h.rateDate !== today && notFuture(h.rateDate, now)) out.push(snap(h.rateDate, h.session, h.per10g, 'website', now));
    logger.debug({ today: Object.keys(parsed.today), history: parsed.history.length }, 'IBJA page parsed');
    return out;
  }
}

export function createIbjaSource(cfg: Config, fetchFn?: FetchLike): IbjaRateSource {
  return cfg.IBJA_SOURCE === 'api' ? new IbjaApiSource(cfg, fetchFn) : new IbjaWebsiteSource(cfg.IBJA_WEBSITE_URL, fetchFn);
}
