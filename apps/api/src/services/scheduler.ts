/**
 * Scheduler run logic (SPEC §6). The worker calls tick() every minute; the API calls sendNow() for the admin.
 * RULE 2: only a rate with date == today (IST) and status == approved is ever sent.
 * RULE 5: one delivery per date+channel (idempotency key, unique index) – re-runs skip successful channels.
 */
import {
  addDays, addMinutes, backoffDelayMs, decideSend, deliveryIdempotencyKey, healthCheckIsPreviousDay, istDate, istTime, isCutoffMinute, isHealthCheckMinute,
  isSendOrRecheckMinute, isWithinSendWindow, retryWithBackoff,
} from '@chheda/shared';
import type { Config } from '../config';
import { logger } from '../lib/logger';
import { Delivery, Rate, SendDay, getSettings } from '../models';
import { raiseAlert } from './alerts';
import { withLock } from './lock';
import { previewSavedRate } from './preview';
import { AUTO_CHANNELS, MANUAL_CHANNELS, createPublishers, type AutoChannel, type PublishPayload, type PublisherMap } from './publishers';
import { isRetryable, type FetchLike } from './meta/client';
import { checkIntegrationsHealth } from './integrations';
import { notifyStaffReady, remindPendingManual } from './staff';
import type { StorageAdapter } from './storage';

export interface SchedulerDeps {
  cfg: Config;
  storage: StorageAdapter;
  publishers?: PublisherMap;
  /** injectable for tests (fake timers) */
  sleep?: (ms: number) => Promise<void>;
  backoffBaseMs?: number;
  /** injectable HTTP for tests – no network ever in tests */
  fetchFn?: FetchLike;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const channelSettingKey: Record<AutoChannel, 'igFeed' | 'igStory' | 'waCustomers'> = { ig_feed: 'igFeed', ig_story: 'igStory', wa_customers: 'waCustomers' };

export type TickResult = { date: string; time: string; healthCheck?: unknown; send?: SendAttemptResult; closed?: unknown };
export type SendAttemptResult =
  | { action: 'locked' }
  | { action: 'automation_off' | 'already_sent' | 'after_cutoff' }
  | { action: 'rate_missing'; reason: string; alertCreated: boolean }
  | { action: 'sent' | 'partial'; channels: Record<string, string> };

/** Called once a minute by the worker (and by tests with a controlled `now`). */
export async function tick(now: Date, deps: SchedulerDeps): Promise<TickResult> {
  const date = istDate(now), time = istTime(now);
  const s = await getSettings();
  const window = { sendTime: s.sendTime, cutoffTime: s.cutoffTime };
  const out: TickResult = { date, time };
  // the check is about the day being sent – which is tomorrow when the send time is before 00:30
  if (isHealthCheckMinute(time, window)) out.healthCheck = await healthCheck(healthCheckIsPreviousDay(window) ? addDays(date, 1) : date, deps);
  if (isSendOrRecheckMinute(time, window)) out.send = await attemptSend(date, now, 'cron', deps);
  if (isCutoffMinute(time, window)) out.closed = await closeDay(date, now, 'Cut-off time passed without an approved rate.');
  const r = await remindPendingManual(deps.cfg, now);
  if (r.reminded) (out as any).reminders = r.reminded;
  return out;
}

/** On worker start: if we are inside today's window and nothing was sent, run now (SPEC §6 missed-run recovery). */
export async function recoverMissedRun(now: Date, deps: SchedulerDeps): Promise<SendAttemptResult | { action: 'outside_window' }> {
  const s = await getSettings();
  const time = istTime(now);
  if (!isWithinSendWindow(time, { sendTime: s.sendTime, cutoffTime: s.cutoffTime })) return { action: 'outside_window' };
  logger.info({ time }, 'Worker started inside the send window – running missed-run recovery');
  return attemptSend(istDate(now), now, 'cron', deps);
}

/** Admin "Send Now": same approval rule as the scheduler; ignores automation switch + cutoff; skips channels already sent. */
export const sendNow = (now: Date, deps: SchedulerDeps) => attemptSend(istDate(now), now, 'send_now', deps);

export async function attemptSend(date: string, now: Date, trigger: 'cron' | 'send_now', deps: SchedulerDeps): Promise<SendAttemptResult> {
  const r = await withLock(`send:${date}`, 5 * 60_000, async () => {
    const s = await getSettings();
    const rate = await Rate.findOne({ date });
    const day = await SendDay.findOneAndUpdate({ date }, { $set: { lastCheckAt: now }, $setOnInsert: { status: 'pending' } }, { upsert: true, new: true });
    if (day.status === 'skipped' && trigger === 'cron') return { action: 'after_cutoff' } as SendAttemptResult;

    const decision = decideSend({ now: istTime(now), window: { sendTime: s.sendTime, cutoffTime: s.cutoffTime }, automationOn: s.automationOn, trigger, rateStatus: (rate?.status as any) ?? null });
    if (decision.action === 'automation_off') { logger.info({ date }, 'Automation is OFF – skipped'); return decision; }
    if (decision.action === 'already_sent' || decision.action === 'after_cutoff') return decision;
    if (decision.action === 'rate_missing') {
      const a = await raiseAlert({ type: 'rate_missing', severity: 'critical', date, dedupeKey: `rate_missing:${date}`,
        message: `Nothing was sent at ${s.sendTime}: ${decision.reason} Approve today's rate before ${s.cutoffTime} IST – the system will never send an old rate.` });
      await SendDay.updateOne({ date }, { $set: { status: 'rate_missing', reason: decision.reason }, $setOnInsert: {} });
      logger.warn({ date, reason: decision.reason }, 'RATE MISSING – nothing sent');
      return { action: 'rate_missing' as const, reason: decision.reason, alertCreated: a.created };
    }
    return sendApprovedRate(rate!, date, now, trigger, s, deps);
  });
  return r.ran ? r.result : { action: 'locked' };
}

async function sendApprovedRate(rate: any, date: string, now: Date, trigger: 'cron' | 'send_now', s: any, deps: SchedulerDeps): Promise<SendAttemptResult> {
  const publishers = deps.publishers ?? await createPublishers(deps.cfg, { fetchFn: deps.fetchFn, sleep: deps.sleep });
  const sleep = deps.sleep ?? defaultSleep;
  await SendDay.updateOne({ date }, { $set: { firstAttemptAt: now }, $inc: { attempts: 1 } });

  const rendered = await previewSavedRate(deps.storage, date); // exact stored values → images + caption
  const payload: PublishPayload = { date, feedUrl: rendered.feedUrl, storyUrl: rendered.storyUrl, caption: rendered.caption, rateId: rate._id,
    rate: { k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities.map((p: any) => ({ label: p.label, value: p.value })) } };

  const channels: Record<string, string> = {};
  const enabled = AUTO_CHANNELS.filter((c) => s.channels?.[channelSettingKey[c]] !== false);
  for (const channel of enabled) channels[channel] = await deliverChannel(channel, payload, rate._id, trigger, publishers, sleep, deps);

  if (s.channels?.staffShare !== false) {
    let createdManual = 0;
    for (const channel of MANUAL_CHANNELS) {
      const r = await Delivery.updateOne({ idempotencyKey: deliveryIdempotencyKey(date, channel, 'cron') },
        { $setOnInsert: { rateId: rate._id, date, channel, trigger, status: 'pending_manual', dryRun: deps.cfg.DRY_RUN, creativeUrls: { feed: payload.feedUrl, story: payload.storyUrl }, caption: payload.caption } },
        { upsert: true });
      if (r.upsertedCount) createdManual++;
      channels[channel] = 'pending_manual';
    }
    if (createdManual) await notifyStaffReady(deps.cfg, date).catch((err) => logger.warn({ err }, 'staff push failed'));
  }

  const allOk = enabled.every((c) => channels[c] === 'success');
  if (allOk) {
    rate.set({ status: 'sent' });
    rate.revisions.push({ at: now, by: `scheduler:${trigger}`, action: 'sent', from: { status: 'approved' }, to: { status: 'sent' } });
    await rate.save();
    await SendDay.updateOne({ date }, { $set: { status: 'sent', sentAt: now, reason: undefined } });
    logger.info({ date, channels, dryRun: deps.cfg.DRY_RUN }, 'Rate sent on all automatic channels');
    return { action: 'sent', channels };
  }
  await SendDay.updateOne({ date }, { $set: { status: 'partial', reason: 'One or more channels failed' } });
  const failed = enabled.filter((c) => channels[c] !== 'success');
  const allFailed = failed.length === enabled.length;
  await raiseAlert({ type: allFailed ? 'send_failed' : 'partial_send', severity: 'critical', date, dedupeKey: `${allFailed ? 'send_failed' : 'partial_send'}:${date}:${failed.join(',')}:${trigger}:${now.getTime()}`,
    message: `Sending failed on ${failed.join(', ')}. Successful channels will not be repeated – use Send Now to retry the failed ones.`, meta: channels });
  return { action: 'partial', channels };
}

/** One channel: idempotent delivery row, up to MAX_ATTEMPTS with exponential backoff. Never repeats a success. */
async function deliverChannel(channel: AutoChannel, payload: PublishPayload, rateId: unknown, trigger: 'cron' | 'send_now', publishers: PublisherMap, sleep: (ms: number) => Promise<void>, deps: SchedulerDeps): Promise<string> {
  const key = deliveryIdempotencyKey(payload.date, channel, trigger === 'send_now' ? 'send_now' : 'cron');
  const existing = await Delivery.findOne({ idempotencyKey: key });
  if (existing?.status === 'success') return 'success';
  const delivery = existing ?? await Delivery.create({ rateId, date: payload.date, channel, trigger, status: 'queued', idempotencyKey: key, dryRun: deps.cfg.DRY_RUN, attempts: 0,
    creativeUrls: { feed: payload.feedUrl, story: payload.storyUrl }, caption: payload.caption });
  const publisher = publishers[channel];
  if (!publisher) { await delivery.set({ status: 'failed', error: 'No publisher configured' }).save(); return 'failed'; }

  const r = await retryWithBackoff(async () => {
    delivery.attempts = (delivery.attempts ?? 0) + 1;
    return publisher.publish(payload);
  }, {
    sleep, baseMs: deps.backoffBaseMs,
    shouldRetry: (e) => isRetryable(e),   // permanent Meta errors (bad token, limit reached, policy) are not retried
    onError: async (e: any, attempt) => {
      const msg = e?.message ?? String(e);
      logger.warn({ channel, attempt, err: msg, retryable: isRetryable(e) }, 'publish attempt failed');
      await delivery.set({ error: msg, retryable: isRetryable(e), metaErrorCode: e?.code }).save();
    },
  });
  if (r.ok) {
    delivery.set({ status: 'success', externalId: r.value.externalId, error: undefined, trigger, ...(r.value.stats && { stats: r.value.stats }) });
    await delivery.save();
    return 'success';
  }
  await delivery.set({ status: 'failed' }).save();
  return 'failed';
}

/** After the cutoff: if nothing was sent, close the day so re-checks stop, and tell the admin. */
export async function closeDay(date: string, now: Date, reason: string) {
  const day = await SendDay.findOne({ date });
  if (day?.status === 'sent') return { closed: false, status: 'sent' };
  const partial = day?.status === 'partial';
  const finalReason = partial ? 'Cut-off passed with some channels still failed – use Send Now to retry them.' : reason;
  await SendDay.updateOne({ date }, { $set: { status: 'skipped', reason: finalReason, closedAt: now }, $setOnInsert: { firstAttemptAt: now } }, { upsert: true });
  const rate = await Rate.findOne({ date });
  if (rate?.status !== 'sent') {
    await raiseAlert({ type: 'day_skipped', severity: 'critical', date, dedupeKey: `day_skipped:${date}`,
      message: partial ? `Only some channels were sent on ${date}. ${finalReason}` : `No rate was sent on ${date}. ${finalReason}` });
  }
  logger.warn({ date, reason }, 'Day closed without sending');
  return { closed: true, status: 'skipped' };
}

/** sendTime − 30 min: is everything ready? Raises one alert per day when it is not. */
export async function healthCheck(date: string, deps: SchedulerDeps) {
  const s = await getSettings();
  const problems: string[] = [];
  const rate = await Rate.findOne({ date });
  if (!rate) problems.push('no rate entered for today');
  else if (rate.status !== 'approved' && rate.status !== 'sent') problems.push(`today's rate is ${rate.status}, not approved`);
  if (!s.automationOn) problems.push('automation is OFF');
  if (rate && rate.status !== 'cancelled') {
    try { await previewSavedRate(deps.storage, date); } catch (e: any) { problems.push(`creative failed to render: ${e?.message}`); }
  }
  problems.push(...await checkIntegrationsHealth(deps.cfg, date, deps.fetchFn));
  await SendDay.updateOne({ date }, { $set: { healthCheckAt: new Date() }, $setOnInsert: { status: 'pending' } }, { upsert: true });
  if (problems.length) {
    await raiseAlert({ type: 'health_check', severity: 'warning', date, dedupeKey: `health_check:${date}`,
      message: `Pre-send check (${addMinutes(s.sendTime, -30)} IST): ${problems.join('; ')}. Fix before ${s.sendTime}.` });
  }
  return { ok: problems.length === 0, problems };
}
