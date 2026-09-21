/**
 * Pure scheduler rules (SPEC §6). No I/O – everything here is unit-testable with plain values.
 * All times are "HH:mm" in Asia/Kolkata; dates are YYYY-MM-DD in IST.
 */
export const RECHECK_INTERVAL_MIN = 15;
export const HEALTH_CHECK_LEAD_MIN = 30;
export const MAX_ATTEMPTS = 3;

export const toMinutes = (hhmm: string): number => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Bad time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};
export const fromMinutes = (mins: number): string => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const addMinutes = (hhmm: string, n: number) => fromMinutes(toMinutes(hhmm) + n);

export interface ScheduleWindow { sendTime: string; cutoffTime: string }

/** The health check runs once, 30 minutes before the send time. */
export const healthCheckTime = (w: ScheduleWindow) => fromMinutes(toMinutes(w.sendTime) - HEALTH_CHECK_LEAD_MIN);
export const isHealthCheckMinute = (now: string, w: ScheduleWindow) => now === healthCheckTime(w);
/** True when the health check falls on the previous calendar day (send time before 00:30). */
export const healthCheckIsPreviousDay = (w: ScheduleWindow) => toMinutes(w.sendTime) - HEALTH_CHECK_LEAD_MIN < 0;

/** sendTime ≤ now < cutoff */
export const isWithinSendWindow = (now: string, w: ScheduleWindow) => {
  const n = toMinutes(now);
  return n >= toMinutes(w.sendTime) && n < toMinutes(w.cutoffTime);
};

/** The send minute itself, or every 15 minutes after it while still before the cutoff. */
export const isSendOrRecheckMinute = (now: string, w: ScheduleWindow) => {
  if (!isWithinSendWindow(now, w)) return false;
  return (toMinutes(now) - toMinutes(w.sendTime)) % RECHECK_INTERVAL_MIN === 0;
};

/** First minute at/after the cutoff – the day is closed exactly once. */
export const isCutoffMinute = (now: string, w: ScheduleWindow) => toMinutes(now) === toMinutes(w.cutoffTime);

/** Exponential backoff between attempts: 1 s, 4 s, 16 s. */
export const backoffDelayMs = (attempt: number, baseMs = 1000) => baseMs * 4 ** attempt;

export type SendDecision =
  | { action: 'send' }
  | { action: 'already_sent' }
  | { action: 'automation_off' }
  | { action: 'rate_missing'; reason: string }
  | { action: 'after_cutoff' };

export interface SendDecisionInput {
  now: string;                      // HH:mm IST
  window: ScheduleWindow;
  automationOn: boolean;
  trigger: 'cron' | 'send_now';
  rateStatus: 'draft' | 'approved' | 'sent' | 'cancelled' | null;
}

/**
 * RULE 2 (CLAUDE.md): only a rate for TODAY with status approved may be sent. Anything else → send nothing.
 * Send Now (admin action) ignores the automation switch and the cutoff, but never the approval rule.
 */
export function decideSend(i: SendDecisionInput): SendDecision {
  if (i.rateStatus === 'sent') return { action: 'already_sent' };
  if (i.trigger === 'cron') {
    if (!i.automationOn) return { action: 'automation_off' };
    if (toMinutes(i.now) >= toMinutes(i.window.cutoffTime)) return { action: 'after_cutoff' };
  }
  if (i.rateStatus === 'approved') return { action: 'send' };
  const reason = i.rateStatus === null ? 'No rate has been entered for today.'
    : i.rateStatus === 'draft' ? "Today's rate is saved but not approved."
    : "Today's rate was cancelled.";
  return { action: 'rate_missing', reason };
}

/** Next scheduled send as an ISO-like description for the dashboard. */
export function nextSendDescription(nowDate: string, nowTime: string, sendTime: string, addDays: (d: string, n: number) => string) {
  return toMinutes(nowTime) < toMinutes(sendTime) ? { date: nowDate, time: sendTime } : { date: addDays(nowDate, 1), time: sendTime };
}

export const ALERT_TYPES = ['rate_missing', 'send_failed', 'partial_send', 'token_expiring', 'manual_pending', 'health_check', 'day_skipped', 'keyword_reply_failed', 'ibja_draft_ready', 'ibja_fetch_failed'] as const;
/** The same alert type for the same date is notified at most once per this window. */
export const ALERT_NOTIFY_WINDOW_MIN = 30;
export const DEFAULT_MANUAL_REMINDER_MIN = 30;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const SEND_DAY_STATUSES = ['pending', 'rate_missing', 'partial', 'sent', 'skipped'] as const;
export type SendDayStatus = (typeof SEND_DAY_STATUSES)[number];

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (err: unknown, attempt: number) => void | Promise<void>;
  /** return false to stop retrying (permanent error) */
  shouldRetry?: (err: unknown) => boolean;
}
export type RetryResult<T> = { ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number };

/** Runs fn up to `attempts` times, waiting backoffDelayMs(0..) between tries (1 s, 4 s, 16 s by default). */
export async function retryWithBackoff<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions = {}): Promise<RetryResult<T>> {
  const attempts = o.attempts ?? MAX_ATTEMPTS;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let error: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(backoffDelayMs(attempt - 1, o.baseMs));
    try { return { ok: true, value: await fn(attempt), attempts: attempt + 1 }; }
    catch (e) {
      error = e; await o.onError?.(e, attempt + 1);
      if (o.shouldRetry && !o.shouldRetry(e)) return { ok: false, error, attempts: attempt + 1 };
    }
  }
  return { ok: false, error, attempts };
}
