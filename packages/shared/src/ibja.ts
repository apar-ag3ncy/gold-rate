/**
 * IBJA (India Bullion and Jewellers Association) benchmark rates.
 * IBJA publishes gold per 10 g (AM ≈ 12:10, PM ≈ 18:10 IST). The shop posts per gram, so the ONLY arithmetic we do is the
 * exact unit conversion ÷ 10 as a decimal-string shift (153056 → 15305.6) – never rounding, never a margin.
 * Purity mapping used by the shop: 999 → 24K, 916 → 22K, 750 → 18K.
 */
export const IBJA_SESSIONS = ['AM', 'PM'] as const;
export type IbjaSession = (typeof IBJA_SESSIONS)[number];
export const IBJA_PURITIES = ['999', '995', '916', '750', '585'] as const;
export type IbjaPurity = (typeof IBJA_PURITIES)[number];
export const IBJA_KARAT_MAP: Record<'k24' | 'k22' | 'k18', IbjaPurity> = { k24: '999', k22: '916', k18: '750' };
export const IBJA_SOURCES = ['api', 'website'] as const;
export type IbjaSource = (typeof IBJA_SOURCES)[number];

export interface IbjaPer10g { '999'?: string; '995'?: string; '916'?: string; '750'?: string; '585'?: string; silver999?: string; platinum999?: string }
export interface IbjaSnapshot {
  rateDate: string;          // YYYY-MM-DD (IST) the rate was published for
  session: IbjaSession;
  per10g: IbjaPer10g;        // exact digits as published (₹ per 10 g; silver per kg)
  perGram: { k24: string; k22: string; k18: string };   // exact ÷10 of 999 / 916 / 750
  source: IbjaSource;
  fetchedAt: string;         // ISO
}

/** "153056" → "15305.6", "1530560" → "153056", "5" → "0.5". Digits only; no floating point involved. */
export function per10gToPerGram(per10g: string): string {
  const s = per10g.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`IBJA rate is not a plain number: ${per10g}`);
  const [intPart, frac = ''] = s.split('.');
  const digits = intPart.padStart(2, '0');
  const head = digits.slice(0, -1).replace(/^0+(?=\d)/, '');
  const tail = `${digits.slice(-1)}${frac}`.replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

/** dd/MM/yyyy (IBJA) → YYYY-MM-DD */
export function ibjaDateToIso(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) throw new Error(`Bad IBJA date: ${d}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}
/** YYYY-MM-DD → dd/MM/yyyy (IBJA API parameters) */
export const isoToIbjaDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
/** IBJA API "RateTime" → session */
export const ibjaRateTimeToSession = (t: string): IbjaSession | null => { const x = t.trim().toUpperCase().replace(/\s+/g, ''); return /^(12(:00)?)?AM$/.test(x) ? 'AM' : /^(6(:00)?|18(:00)?)?PM$/.test(x) ? 'PM' : null; };

/** Build the per-gram trio from a per-10 g table; throws if any of 999 / 916 / 750 is missing. */
export function perGramFromPer10g(p: IbjaPer10g): IbjaSnapshot['perGram'] {
  for (const k of ['999', '916', '750'] as const) if (!p[k] || !(Number(p[k]) > 0)) throw new Error(`IBJA ${k} purity missing or zero`);
  return { k24: per10gToPerGram(p['999']!), k22: per10gToPerGram(p['916']!), k18: per10gToPerGram(p['750']!) };
}

export interface IbjaSettings {
  enabled: boolean;
  autoDraft: boolean;           // create/refresh a DRAFT for draftFor after each fetch
  autoApprove: boolean;         // ALSO approve it (skips the human check – off by default, requires autoDraft)
  draftFor: 'today' | 'tomorrow';
  preferSession: IbjaSession;   // which session feeds the draft when both exist for the date
  fetchTimes: string[];         // HH:mm IST, after IBJA's 12:10 / 18:10 publishes
  maxAgeDays: number;           // a snapshot older than this (vs the draft date) is never used – covers weekends + holidays
}
export const DEFAULT_IBJA_SETTINGS: IbjaSettings = { enabled: true, autoDraft: false, autoApprove: false, draftFor: 'tomorrow', preferSession: 'PM', fetchTimes: ['12:40', '18:40'], maxAgeDays: 4 };
export const IBJA_FETCH_TIMEOUT_MS = 15_000;
export const IBJA_RETRY_AFTER_MIN = 10;
export const IBJA_MAX_ATTEMPTS_PER_SLOT = 3;
export const IBJA_API_DAILY_QUOTA = 40;
export const IBJA_API_QUOTA_RESERVE = 10;   // manual refreshes stop when only this many hits are left for the scheduler
