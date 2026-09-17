import { describe, it, expect, vi } from 'vitest';
import {
  addMinutes, backoffDelayMs, decideSend, retryWithBackoff, healthCheckTime, healthCheckIsPreviousDay, isCutoffMinute, isHealthCheckMinute, isSendOrRecheckMinute, isWithinSendWindow, nextSendDescription, toMinutes,
} from '../src';
import { addDays } from '../src';

const w = { sendTime: '07:00', cutoffTime: '11:00' };

describe('time helpers', () => {
  it('parses and adds minutes', () => {
    expect(toMinutes('07:05')).toBe(425);
    expect(addMinutes('07:00', -30)).toBe('06:30');
    expect(addMinutes('23:50', 20)).toBe('00:10');
    expect(() => toMinutes('7am')).toThrow();
  });
  it('health check is exactly sendTime − 30', () => {
    expect(isHealthCheckMinute('06:30', w)).toBe(true);
    expect(isHealthCheckMinute('06:29', w)).toBe(false);
    // a send time just after midnight checks the evening before
    expect(healthCheckTime({ sendTime: '00:10', cutoffTime: '04:00' })).toBe('23:40');
    expect(isHealthCheckMinute('23:40', { sendTime: '00:10', cutoffTime: '04:00' })).toBe(true);
    expect(healthCheckIsPreviousDay({ sendTime: '00:10', cutoffTime: '04:00' })).toBe(true);
    expect(healthCheckIsPreviousDay(w)).toBe(false);
  });
  it('send / re-check minutes: send time, then every 15 min until cutoff', () => {
    expect(isSendOrRecheckMinute('07:00', w)).toBe(true);
    expect(isSendOrRecheckMinute('07:15', w)).toBe(true);
    expect(isSendOrRecheckMinute('07:10', w)).toBe(false);
    expect(isSendOrRecheckMinute('10:45', w)).toBe(true);
    expect(isSendOrRecheckMinute('11:00', w)).toBe(false); // cutoff – not a send minute
    expect(isSendOrRecheckMinute('06:45', w)).toBe(false);
    expect(isWithinSendWindow('10:59', w)).toBe(true);
    expect(isCutoffMinute('11:00', w)).toBe(true);
  });
  it('backoff grows exponentially', () => {
    expect([0, 1, 2].map((a) => backoffDelayMs(a))).toEqual([1000, 4000, 16000]);
  });
  it('describes the next send', () => {
    expect(nextSendDescription('2026-09-18', '06:00', '07:00', addDays)).toEqual({ date: '2026-09-18', time: '07:00' });
    expect(nextSendDescription('2026-09-18', '07:00', '07:00', addDays)).toEqual({ date: '2026-09-19', time: '07:00' });
  });
});

describe('decideSend – only today + approved is ever sent', () => {
  const base = { now: '07:00', window: w, automationOn: true, trigger: 'cron' as const };
  it('sends an approved rate', () => expect(decideSend({ ...base, rateStatus: 'approved' })).toEqual({ action: 'send' }));
  it('never sends draft / cancelled / missing', () => {
    expect(decideSend({ ...base, rateStatus: 'draft' }).action).toBe('rate_missing');
    expect(decideSend({ ...base, rateStatus: 'cancelled' }).action).toBe('rate_missing');
    expect(decideSend({ ...base, rateStatus: null }).action).toBe('rate_missing');
  });
  it('does nothing when automation is off (cron only)', () => {
    expect(decideSend({ ...base, automationOn: false, rateStatus: 'approved' }).action).toBe('automation_off');
    expect(decideSend({ ...base, automationOn: false, trigger: 'send_now', rateStatus: 'approved' }).action).toBe('send');
  });
  it('cron stops at the cutoff; Send Now still works but never bypasses approval', () => {
    expect(decideSend({ ...base, now: '11:00', rateStatus: 'approved' }).action).toBe('after_cutoff');
    expect(decideSend({ ...base, now: '11:00', trigger: 'send_now', rateStatus: 'approved' }).action).toBe('send');
    expect(decideSend({ ...base, now: '11:00', trigger: 'send_now', rateStatus: 'draft' }).action).toBe('rate_missing');
  });
  it('already sent → nothing', () => expect(decideSend({ ...base, rateStatus: 'sent' }).action).toBe('already_sent'));
});

describe('retryWithBackoff (fake timers)', () => {
  it('waits 1 s then 4 s between attempts and succeeds on the third try', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = retryWithBackoff(async () => { calls++; if (calls < 3) throw new Error('boom'); return 'ok'; });
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: true, value: 'ok', attempts: 3 });
    vi.useRealTimers();
  });
  it('gives up after 3 attempts and reports the last error', async () => {
    const errors: number[] = [];
    const r = await retryWithBackoff(async () => { throw new Error('nope'); }, { sleep: async () => {}, onError: (_e, a) => { errors.push(a); } });
    expect(r).toMatchObject({ ok: false, attempts: 3 });
    expect(errors).toEqual([1, 2, 3]);
  });
});
