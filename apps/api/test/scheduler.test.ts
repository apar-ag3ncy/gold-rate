import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { addDays, istDate } from '@chheda/shared';
import { Alert, Delivery, JobLock, Rate, SendDay, Settings, getSettings } from '../src/models';
import { attemptSend, closeDay, healthCheck, recoverMissedRun, tick } from '../src/services/scheduler';
import type { Publisher, PublisherMap, PublishPayload } from '../src/services/publishers';
import { createStorage } from '../src/services/storage';
import { loadConfig } from '../src/config';
import { login, makeUser, startTestApp, stopTestApp, TEST_MEDIA_DIR } from './setup';

/** IST instant for a given YYYY-MM-DD + HH:mm */
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const good = { k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [{ label: '14K', value: 6560 }] };

class FakePublisher implements Publisher {
  calls: PublishPayload[] = [];
  failTimes = 0;
  constructor(readonly channel: any) {}
  async publish(p: PublishPayload) {
    this.calls.push(p);
    if (this.failTimes > 0) { this.failTimes--; throw new Error(`boom ${this.channel}`); }
    return { externalId: `${this.channel}:${p.date}:${this.calls.length}` };
  }
}

let app: any;
let deps: any;
let pubs: Record<string, FakePublisher>;
let today: string;

async function resetDay() {
  await Promise.all([Rate.deleteMany({}), Delivery.deleteMany({}), Alert.deleteMany({}), SendDay.deleteMany({}), JobLock.deleteMany({})]);
  pubs = { ig_feed: new FakePublisher('ig_feed'), ig_story: new FakePublisher('ig_story'), wa_customers: new FakePublisher('wa_customers') };
  deps = { cfg: loadConfig({ NODE_ENV: 'test', MONGO_URI: 'x', MEDIA_DIR: TEST_MEDIA_DIR, MEDIA_BASE_URL: 'http://localhost:4000' } as any), storage: createStorage(loadConfig({ NODE_ENV: 'test', MONGO_URI: 'x', MEDIA_DIR: TEST_MEDIA_DIR, MEDIA_BASE_URL: 'http://localhost:4000' } as any)), publishers: pubs as unknown as PublisherMap, sleep: async () => {} };
  const s = await getSettings();
  s.set({ automationOn: true, sendTime: '07:00', cutoffTime: '11:00', channels: { igFeed: true, igStory: true, waCustomers: true, staffShare: true, rateKeywordReply: true } });
  await s.save();
}
const approvedToday = (date = today) => Rate.create({ date, ...good, status: 'approved', enteredBy: 'a', approvedBy: 'a', approvedAt: new Date() });

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin');
  await makeUser('staff@chheda.test', 'staff');
});
afterAll(stopTestApp);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); // control "now" only – real timers keep the Mongo driver alive
  // "today" is a fixed IST calendar day; the fake clock starts at 06:00 IST
  vi.setSystemTime(new Date('2026-09-18T06:00:00+05:30'));
  today = istDate();
  await resetDay();
});
afterEach(() => vi.useRealTimers());

describe('scheduler tick – timing rules', () => {
  it('does nothing outside the scheduled minutes', async () => {
    await approvedToday();
    const r = await tick(ist(today, '06:59'), deps);
    expect(r.send).toBeUndefined(); expect(r.healthCheck).toBeUndefined(); expect(r.closed).toBeUndefined();
    expect(await Delivery.countDocuments()).toBe(0);
  });
  it('sends the approved rate at the send time on every enabled channel, once', async () => {
    await approvedToday();
    const r = await tick(ist(today, '07:00'), deps);
    expect(r.send).toMatchObject({ action: 'sent', channels: { ig_feed: 'success', ig_story: 'success', wa_customers: 'success', ig_broadcast_manual: 'pending_manual', wa_channel_manual: 'pending_manual', wa_community_manual: 'pending_manual' } });
    const rate = await Rate.findOne({ date: today });
    expect(rate!.status).toBe('sent');
    const ds = await Delivery.find({ date: today }).sort({ channel: 1 });
    expect(ds.map((d) => `${d.channel}:${d.status}:${d.idempotencyKey}`)).toEqual([
      `ig_broadcast_manual:pending_manual:${today}:ig_broadcast_manual`, `ig_feed:success:${today}:ig_feed`, `ig_story:success:${today}:ig_story`,
      `wa_channel_manual:pending_manual:${today}:wa_channel_manual`, `wa_community_manual:pending_manual:${today}:wa_community_manual`, `wa_customers:success:${today}:wa_customers`]);
    expect(pubs.ig_feed.calls[0]).toMatchObject({ date: today, rate: { k24: 11250, k22: 10305.5, k18: 8437 } });
    expect(pubs.ig_feed.calls[0].caption).toContain('₹10,305.5');
    // a later re-check does not send again (idempotency + status sent)
    const again = await tick(ist(today, '07:15'), deps);
    expect(again.send).toEqual({ action: 'already_sent' });
    expect(pubs.ig_feed.calls).toHaveLength(1);
    expect(await Delivery.countDocuments({ date: today })).toBe(6);
    expect((await SendDay.findOne({ date: today }))!.status).toBe('sent');
  });
  it('automation OFF → logs skipped, sends nothing, no alert', async () => {
    await approvedToday();
    await Settings.updateOne({ _id: 'main' }, { automationOn: false });
    const r = await tick(ist(today, '07:00'), deps);
    expect(r.send).toEqual({ action: 'automation_off' });
    expect(await Delivery.countDocuments()).toBe(0);
    expect(await Alert.countDocuments()).toBe(0);
    expect((await Rate.findOne({ date: today }))!.status).toBe('approved');
  });
  it('no approved rate → sends nothing, raises ONE rate_missing alert, re-checks every 15 min', async () => {
    await Rate.create({ date: today, ...good, status: 'draft', enteredBy: 'a' });
    const r1 = await tick(ist(today, '07:00'), deps);
    expect(r1.send).toMatchObject({ action: 'rate_missing', alertCreated: true });
    const r2 = await tick(ist(today, '07:15'), deps);
    expect(r2.send).toMatchObject({ action: 'rate_missing', alertCreated: false });
    expect((await tick(ist(today, '07:20'), deps)).send).toBeUndefined();
    expect(await Alert.countDocuments({ type: 'rate_missing', date: today })).toBe(1);
    expect(await Delivery.countDocuments()).toBe(0);
    expect((await SendDay.findOne({ date: today }))!.status).toBe('rate_missing');
    // admin approves at 07:20 → the 07:30 re-check sends
    await Rate.updateOne({ date: today }, { status: 'approved' });
    const r3 = await tick(ist(today, '07:30'), deps);
    expect(r3.send!.action).toBe('sent');
    expect((await Rate.findOne({ date: today }))!.status).toBe('sent');
  });
  it('never sends an old rate: yesterday approved, today missing', async () => {
    await approvedToday(addDays(today, -1));
    const r = await tick(ist(today, '07:00'), deps);
    expect(r.send!.action).toBe('rate_missing');
    expect(await Delivery.countDocuments()).toBe(0);
    expect((await Rate.findOne({ date: addDays(today, -1) }))!.status).toBe('approved');
  });
  it('cancelled rate is never sent', async () => {
    await Rate.create({ date: today, ...good, status: 'cancelled', enteredBy: 'a' });
    expect((await tick(ist(today, '07:00'), deps)).send!.action).toBe('rate_missing');
    expect(await Delivery.countDocuments()).toBe(0);
  });
  it('cutoff closes the day: skipped + alert, later re-checks do nothing, and an approval after cutoff is not sent by cron', async () => {
    const r = await tick(ist(today, '11:00'), deps);
    expect(r.closed).toEqual({ closed: true, status: 'skipped' });
    expect((await SendDay.findOne({ date: today }))!.status).toBe('skipped');
    expect(await Alert.countDocuments({ type: 'day_skipped', date: today })).toBe(1);
    await approvedToday();
    expect(await attemptSend(today, ist(today, '11:15'), 'cron', deps)).toEqual({ action: 'after_cutoff' });
    expect(await Delivery.countDocuments()).toBe(0);
    expect((await Rate.findOne({ date: today }))!.status).toBe('approved');
  });
  it('cutoff after a partial send closes the day with a retry hint', async () => {
    await approvedToday();
    pubs.wa_customers.failTimes = 5;
    await attemptSend(today, ist(today, '07:00'), 'cron', deps);
    const r = await tick(ist(today, '11:00'), deps);
    expect(r.closed).toEqual({ closed: true, status: 'skipped' });
    const a = await Alert.findOne({ type: 'day_skipped', date: today });
    expect(a!.message).toMatch(/Only some channels/);
    expect((await SendDay.findOne({ date: today }))!.reason).toMatch(/Send Now/);
  });
  it('health check for a send time just after midnight runs the evening before, for the next day', async () => {
    await Settings.updateOne({ _id: 'main' }, { sendTime: '00:10', cutoffTime: '04:00' });
    const r = await tick(ist(today, '23:40'), deps);
    expect(r.healthCheck).toMatchObject({ ok: false });
    expect(await Alert.countDocuments({ type: 'health_check', date: addDays(today, 1) })).toBe(1);
  });
  it('cutoff after a successful send does not raise an alert', async () => {
    await approvedToday();
    await tick(ist(today, '07:00'), deps);
    const r = await tick(ist(today, '11:00'), deps);
    expect(r.closed).toEqual({ closed: false, status: 'sent' });
    expect(await Alert.countDocuments({ type: 'day_skipped' })).toBe(0);
  });
  it('respects channel toggles', async () => {
    await approvedToday();
    await Settings.updateOne({ _id: 'main' }, { 'channels.igStory': false, 'channels.staffShare': false });
    const r = await tick(ist(today, '07:00'), deps);
    expect(r.send).toMatchObject({ action: 'sent', channels: { ig_feed: 'success', wa_customers: 'success' } });
    expect((await Delivery.find({ date: today })).map((d) => d.channel).sort()).toEqual(['ig_feed', 'wa_customers']);
  });
});

describe('health check at sendTime − 30', () => {
  it('alerts once when the rate is not ready, and not when it is', async () => {
    const r = await tick(ist(today, '06:30'), deps);
    expect(r.healthCheck).toMatchObject({ ok: false });
    expect((r.healthCheck as any).problems.join()).toMatch(/no rate entered/);
    await tick(ist(today, '06:30'), deps);
    expect(await Alert.countDocuments({ type: 'health_check', date: today })).toBe(1);
    await Alert.deleteMany({});
    await approvedToday();
    expect(await healthCheck(today, deps)).toEqual({ ok: true, problems: [] });
    expect(await Alert.countDocuments()).toBe(0);
  });
});

describe('retries, backoff and partial failure', () => {
  it('retries a failing channel 3 times with exponential backoff, marks it failed, keeps the rate approved and alerts', async () => {
    await approvedToday();
    pubs.wa_customers.failTimes = 5;
    const delays: number[] = [];
    deps.sleep = async (ms: number) => { delays.push(ms); };
    const r = await attemptSend(today, ist(today, '07:00'), 'cron', deps);
    expect(r).toMatchObject({ action: 'partial', channels: { ig_feed: 'success', ig_story: 'success', wa_customers: 'failed' } });
    expect(delays).toEqual([1000, 4000]);
    const failed = await Delivery.findOne({ date: today, channel: 'wa_customers' });
    expect(failed).toMatchObject({ status: 'failed', attempts: 3 });
    expect(failed!.error).toMatch(/boom/);
    expect((await Rate.findOne({ date: today }))!.status).toBe('approved');
    expect((await SendDay.findOne({ date: today }))!.status).toBe('partial');
    expect(await Alert.countDocuments({ type: 'partial_send', date: today })).toBe(1);
  });
  it('Send Now retries only the failed channel and then marks the rate sent', async () => {
    await approvedToday();
    pubs.ig_story.failTimes = 5;
    await attemptSend(today, ist(today, '07:00'), 'cron', deps);
    pubs.ig_story.failTimes = 0;
    const before = { feed: pubs.ig_feed.calls.length, wa: pubs.wa_customers.calls.length };
    const r = await attemptSend(today, ist(today, '09:00'), 'send_now', deps);
    expect(r).toMatchObject({ action: 'sent', channels: { ig_feed: 'success', ig_story: 'success', wa_customers: 'success' } });
    expect(pubs.ig_feed.calls).toHaveLength(before.feed);
    expect(pubs.wa_customers.calls).toHaveLength(before.wa);
    expect(await Delivery.countDocuments({ date: today, channel: 'ig_story' })).toBe(1);
    expect((await Delivery.findOne({ date: today, channel: 'ig_story' }))!.status).toBe('success');
    expect((await Rate.findOne({ date: today }))!.status).toBe('sent');
  });
});

describe('locking and recovery', () => {
  it('concurrent attempts: the Mongo job lock lets exactly one run', async () => {
    await approvedToday();
    const [a, b] = await Promise.all([attemptSend(today, ist(today, '07:00'), 'cron', deps), attemptSend(today, ist(today, '07:00'), 'cron', deps)]);
    expect([a.action, b.action].sort()).toEqual(['locked', 'sent']);
    expect(pubs.ig_feed.calls).toHaveLength(1);
    expect(await Delivery.countDocuments({ date: today, channel: 'ig_feed' })).toBe(1);
  });
  it('missed-run recovery sends inside the window and does nothing outside it', async () => {
    await approvedToday();
    expect(await recoverMissedRun(ist(today, '06:00'), deps)).toEqual({ action: 'outside_window' });
    expect(await recoverMissedRun(ist(today, '11:30'), deps)).toEqual({ action: 'outside_window' });
    expect(await Delivery.countDocuments()).toBe(0);
    const r = await recoverMissedRun(ist(today, '08:07'), deps);
    expect(r.action).toBe('sent');
    expect(await recoverMissedRun(ist(today, '08:09'), deps)).toEqual({ action: 'already_sent' });
  });
  it('closeDay is idempotent', async () => {
    await closeDay(today, ist(today, '11:00'), 'x');
    await closeDay(today, ist(today, '11:01'), 'x');
    expect(await Alert.countDocuments({ type: 'day_skipped' })).toBe(1);
  });
});

describe('alerts + Send Now API', () => {
  it('lists and acknowledges alerts', async () => {
    vi.useRealTimers();
    await tick(ist(today, '07:00'), deps); // rate missing → alert
    const admin = await login(app, 'admin@chheda.test');
    const list = await admin.get('/api/v1/alerts?status=open');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ type: 'rate_missing', status: 'open' });
    const ack = await admin.post(`/api/v1/alerts/${list.body.items[0].id}/ack`);
    expect(ack.body.alert).toMatchObject({ status: 'acked', ackBy: 'admin@chheda.test' });
    expect((await admin.get('/api/v1/alerts?status=open')).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/alerts')).status).toBe(401);
    const d = await admin.get(`/api/v1/deliveries?date=${today}`);
    expect(d.body.day).toMatchObject({ status: 'rate_missing', attempts: 0 });
    expect(d.body.day.reason).toMatch(/not approved|No rate/);
  });
  it('Send Now: admin only; 409 when today is not approved; sends when approved (DRY_RUN)', async () => {
    vi.useRealTimers();
    const realToday = istDate();
    const admin = await login(app, 'admin@chheda.test');
    const staff = await login(app, 'staff@chheda.test');
    expect((await staff.post('/api/v1/send/now')).status).toBe(403);
    const missing = await admin.post('/api/v1/send/now');
    expect(missing.status).toBe(409);
    expect(missing.body.result.action).toBe('rate_missing');
    await Rate.create({ date: realToday, ...good, status: 'approved', enteredBy: 'a' });
    const ok = await admin.post('/api/v1/send/now');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ dryRun: true, result: { action: 'sent' } });
    expect((await Rate.findOne({ date: realToday }))!.status).toBe('sent');
    expect((await Delivery.findOne({ date: realToday, channel: 'ig_feed' }))!.externalId).toMatch(/^dry-run:/);
  });
});
