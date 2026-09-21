import { addDays, DEFAULT_IBJA_SETTINGS, IBJA_API_DAILY_QUOTA, IBJA_API_QUOTA_RESERVE, IBJA_MAX_ATTEMPTS_PER_SLOT, IBJA_RETRY_AFTER_MIN, istDate, istTime, rateInputSchema, type IbjaSession, type IbjaSettings, type IbjaSnapshot } from '@chheda/shared';
import type { Config } from '../../config';
import { logger } from '../../lib/logger';
import { Delivery, IbjaFetch, IbjaRate, Rate, getSettings } from '../../models';
import { raiseAlert } from '../alerts';
import { approveRate, saveRate } from '../rates';
import { createIbjaSource, IbjaFetchError, scrubSecret, type FetchLike, type IbjaRateSource } from './sources';

export { parseIbjaHomepage } from './parse';
export { IbjaApiSource, IbjaWebsiteSource, IbjaFetchError, createIbjaSource } from './sources';

export const IBJA_SYSTEM_USER = 'system:ibja';

export function ibjaSettings(s: any): IbjaSettings {
  const i = s?.ibja ?? {};
  return { enabled: i.enabled ?? DEFAULT_IBJA_SETTINGS.enabled, autoDraft: i.autoDraft ?? false, autoApprove: i.autoApprove ?? false, draftFor: i.draftFor ?? 'tomorrow', preferSession: i.preferSession ?? 'PM', fetchTimes: i.fetchTimes?.length ? [...i.fetchTimes] : [...DEFAULT_IBJA_SETTINGS.fetchTimes], maxAgeDays: i.maxAgeDays ?? DEFAULT_IBJA_SETTINGS.maxAgeDays };
}

export const ibjaToDTO = (r: any): IbjaSnapshot & { id?: string } => ({ id: r._id ? String(r._id) : undefined, rateDate: r.rateDate, session: r.session, per10g: { ...(r.per10g?.toObject?.() ?? r.per10g ?? {}) }, perGram: { k24: r.perGram.k24, k22: r.perGram.k22, k18: r.perGram.k18 }, source: r.source, fetchedAt: (r.fetchedAt instanceof Date ? r.fetchedAt : new Date(r.fetchedAt)).toISOString() });

/** Newest stored snapshot (PM before AM on the same date). */
export async function latestIbja() {
  const r = await IbjaRate.findOne().sort({ rateDate: -1, session: -1 }).lean();
  return r ? ibjaToDTO(r) : null;
}
export async function ibjaHistory(limit = 30) {
  return (await IbjaRate.find().sort({ rateDate: -1, session: -1 }).limit(limit).lean()).map(ibjaToDTO);
}

export interface FetchOpts { source?: IbjaRateSource; fetchFn?: FetchLike; now?: Date; slot?: string; by?: string }

/** Fetch from IBJA and upsert every returned snapshot. Returns what is new + the latest snapshot. Never throws – records the failure. */
export async function fetchAndStoreIbja(cfg: Config, opts: FetchOpts = {}) {
  const now = opts.now ?? new Date();
  const source = opts.source ?? createIbjaSource(cfg, opts.fetchFn);
  const slot = opts.slot ?? 'manual';
  // official API quota: keep a reserve for the scheduled slots
  if (source.name === 'api' && slot === 'manual') {
    const used = await IbjaFetch.countDocuments({ date: istDate(now), source: 'api' });
    if (used >= IBJA_API_DAILY_QUOTA - IBJA_API_QUOTA_RESERVE) {
      const error = `IBJA API daily quota nearly used (${used}/${IBJA_API_DAILY_QUOTA}) – manual refresh paused until tomorrow`;
      await IbjaFetch.create({ date: istDate(now), slot, at: now, ok: false, source: source.name, error, by: opts.by });
      return { ok: false as const, error, latest: await latestIbja() };
    }
  }
  try {
    const snapshots = await source.fetchRecent(now);
    let inserted = 0;
    for (const s of snapshots) {
      const r = await IbjaRate.updateOne({ rateDate: s.rateDate, session: s.session }, { $setOnInsert: { per10g: s.per10g, perGram: s.perGram, source: s.source, fetchedAt: new Date(s.fetchedAt) } }, { upsert: true });
      if (r.upsertedCount) inserted++;
    }
    await IbjaFetch.create({ date: istDate(now), slot, at: now, ok: true, source: source.name, snapshots: snapshots.map((s) => ({ rateDate: s.rateDate, session: s.session })), by: opts.by });
    const latest = await latestIbja();
    logger.info({ source: source.name, returned: snapshots.length, inserted, latest: latest && `${latest.rateDate} ${latest.session}` }, 'IBJA fetch ok');
    return { ok: true as const, inserted, returned: snapshots.length, latest };
  } catch (e: any) {
    const msg = scrubSecret(e?.message ?? String(e), cfg.IBJA_API_TOKEN);
    await IbjaFetch.create({ date: istDate(now), slot, at: now, ok: false, source: source.name, error: msg, retryable: e instanceof IbjaFetchError ? e.retryable : true, by: opts.by });
    logger.warn({ err: msg, retryable: e instanceof IbjaFetchError ? e.retryable : undefined }, 'IBJA fetch failed');
    await raiseAlert({ type: 'ibja_fetch_failed', severity: 'warning', date: istDate(now), dedupeKey: `ibja_fetch_failed:${istDate(now)}`, message: `Could not fetch the IBJA benchmark rate (${source.name}): ${msg}. Enter today's rate manually if it is not drafted.` }).catch(() => {});
    return { ok: false as const, error: msg, latest: await latestIbja() };
  }
}

/** The snapshot the draft should use: preferred session of the newest date, else the other session of that date. */
export async function pickIbjaForDraft(prefer: IbjaSession) {
  const newest = await IbjaRate.findOne().sort({ rateDate: -1 }).lean();
  if (!newest) return null;
  const preferred = await IbjaRate.findOne({ rateDate: newest.rateDate, session: prefer }).lean();
  return ibjaToDTO(preferred ?? newest);
}

export type DraftOutcome =
  | { action: 'disabled' | 'no_snapshot' | 'kept_admin_rate' | 'unchanged' | 'sent_locked' | 'cancelled_by_admin' | 'kept_partially_sent' }
  | { action: 'stale'; date: string; snapshotDate: string; maxAgeDays: number }
  | { action: 'drafted' | 'approved'; date: string; from: string; k24: string; k22: string; k18: string; warnings: string[] }
  | { action: 'blocked'; date: string; errors: string[] };

/**
 * Create / refresh the draft for settings.ibja.draftFor from the chosen IBJA snapshot.
 * Never touches a rate a person entered (source=admin) or an approved/sent rate; only (re)writes IBJA-sourced drafts.
 * autoApprove additionally approves it – the scheduler then sends it like any approved rate.
 */
export async function autoDraftFromIbja(cfg: Config, opts: { now?: Date; force?: boolean } = {}): Promise<DraftOutcome> {
  const now = opts.now ?? new Date();
  const s = ibjaSettings(await getSettings());
  if (!s.enabled || (!s.autoDraft && !opts.force)) return { action: 'disabled' };
  const snap = await pickIbjaForDraft(s.preferSession);
  if (!snap) return { action: 'no_snapshot' };
  const date = s.draftFor === 'today' ? istDate(now) : addDays(istDate(now), 1);
  // staleness bound: never let a week-old benchmark become tomorrow's rate (holiday runs, upstream outage)
  if (snap.rateDate < addDays(date, -s.maxAgeDays)) {
    await raiseAlert({ type: 'ibja_fetch_failed', severity: 'warning', date, dedupeKey: `ibja_stale:${date}:${snap.rateDate}`, message: `The newest IBJA rate is from ${snap.rateDate} (${snap.session}) – older than ${s.maxAgeDays} days before ${date}, so nothing was drafted. Enter the rate manually.` }).catch(() => {});
    return { action: 'stale', date, snapshotDate: snap.rateDate, maxAgeDays: s.maxAgeDays };
  }
  const existing = await Rate.findOne({ date });
  if (existing?.status === 'sent') return { action: 'sent_locked' };
  // once anything for that date has gone out (partial send), never change the numbers behind it
  if (existing && await Delivery.exists({ date, status: { $in: ['success', 'queued'] }, recipientHash: { $exists: false } })) return { action: 'kept_partially_sent' };
  // a person cancelled this date: only the explicit "Draft from IBJA now" button (force) may revive it
  if (existing?.status === 'cancelled' && !opts.force) return { action: 'cancelled_by_admin' };
  if (existing && existing.source !== 'ibja') return { action: 'kept_admin_rate' };
  if (existing && existing.status === 'approved' && existing.approvedBy !== IBJA_SYSTEM_USER) return { action: 'kept_admin_rate' };
  if (existing?.ibja?.rateDate === snap.rateDate && existing.ibja?.session === snap.session && !opts.force) return { action: 'unchanged' };
  const from = `IBJA ${snap.session} rate of ${snap.rateDate} (${snap.source})`;
  try {
    // same Zod parse as the API route: numbers, max 2 decimals, > 0 – the business rules then compare numbers, not strings
    const input = rateInputSchema.parse({ k24: snap.perGram.k24, k22: snap.perGram.k22, k18: snap.perGram.k18, extraPurities: [], overrideReason: '' });
    const { rate, warnings } = await saveRate(date, input, IBJA_SYSTEM_USER, now,
      { source: 'ibja', ibja: { rateDate: snap.rateDate, session: snap.session, fetchedAt: new Date(snap.fetchedAt), source: snap.source } });
    let action: 'drafted' | 'approved' = 'drafted';
    if (s.autoApprove) { await approveRate(date, IBJA_SYSTEM_USER, now); action = 'approved'; }
    await raiseAlert({ type: 'ibja_draft_ready', severity: 'info', date, dedupeKey: `ibja_draft:${date}:${snap.rateDate}:${snap.session}:${action}`,
      message: `${action === 'approved' ? 'Auto-approved' : 'Draft ready'} for ${date} from ${from}: 24K ₹${snap.perGram.k24}/g · 22K ₹${snap.perGram.k22}/g · 18K ₹${snap.perGram.k18}/g.${action === 'drafted' ? ' Open Enter Rate to check and approve it.' : ''}${warnings.length ? ` Warnings: ${warnings.join(' ')}` : ''}` });
    logger.info({ date, action, from }, 'IBJA draft');
    return { action, date, from, k24: snap.perGram.k24, k22: snap.perGram.k22, k18: snap.perGram.k18, warnings };
  } catch (e: any) {
    const errors: string[] = (e?.details?.errors ?? e?.issues?.map((i: any) => i.message) ?? [e?.message ?? String(e)]).map((x: string) => x.slice(0, 300));
    await raiseAlert({ type: 'ibja_fetch_failed', severity: 'warning', date, dedupeKey: `ibja_draft_blocked:${date}:${snap.rateDate}:${snap.session}`, message: `IBJA draft for ${date} was blocked by validation: ${errors.join(' ')}` }).catch(() => {});
    return { action: 'blocked', date, errors };
  }
}

/**
 * Scheduler hook (every minute). Runs a fetch when:
 *  - the minute matches a configured slot;
 *  - a slot earlier today never ran (worker was down) → catch-up, once;
 *  - the last attempt for today's most recent slot failed with a retryable error → retry after IBJA_RETRY_AFTER_MIN, max IBJA_MAX_ATTEMPTS_PER_SLOT;
 *  - yesterday's last slot never ran (outage across midnight) → one 'catchup' attempt before today's first slot.
 * Then auto-drafts (if enabled).
 */
export async function ibjaTick(cfg: Config, now: Date, opts: { fetchFn?: FetchLike; source?: IbjaRateSource } = {}) {
  const s = ibjaSettings(await getSettings());
  if (!s.enabled) return null;
  const date = istDate(now), time = istTime(now);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const nowMin = toMin(time);
  const today = await IbjaFetch.find({ date }).sort({ at: 1 }).lean();
  let slot: string | null = s.fetchTimes.find((t) => t === time) ?? null;
  if (!slot) {
    const missed = s.fetchTimes.find((t) => toMin(t) < nowMin && !today.some((d) => d.slot === t));
    if (missed) slot = missed;
  }
  if (!slot) {
    // retry a failed slot (transient errors only, bounded)
    const lastSlot = [...s.fetchTimes].filter((t) => toMin(t) <= nowMin).sort((a, b) => toMin(b) - toMin(a))[0];
    if (lastSlot) {
      const attempts = today.filter((d) => d.slot === lastSlot);
      const last = attempts[attempts.length - 1];
      if (last && !last.ok && last.retryable !== false && attempts.length < IBJA_MAX_ATTEMPTS_PER_SLOT && now.getTime() - new Date(last.at).getTime() >= IBJA_RETRY_AFTER_MIN * 60_000) slot = lastSlot;
    }
  }
  if (!slot) {
    // outage across midnight: yesterday's last slot never ran at all (worker was down) → one catch-up before today's first slot
    const sorted = [...s.fetchTimes].sort((a, b) => toMin(a) - toMin(b));
    if (nowMin < toMin(sorted[0]) && !today.some((d) => d.slot === 'catchup')) {
      const yesterday = addDays(date, -1);
      const [ranYesterday, anyHistory] = await Promise.all([IbjaFetch.exists({ date: yesterday, slot: sorted[sorted.length - 1] }), IbjaFetch.exists({})]);
      if (anyHistory && !ranYesterday) slot = 'catchup';
    }
  }
  if (!slot) return null;
  const fetched = await fetchAndStoreIbja(cfg, { now, slot, fetchFn: opts.fetchFn, source: opts.source });
  const draft = fetched.ok ? await autoDraftFromIbja(cfg, { now }) : null;
  return { slot, fetched: fetched.ok, latest: fetched.latest, draft };
}
