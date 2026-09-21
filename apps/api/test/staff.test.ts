import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { addDays, istDate } from '@chheda/shared';
import { Alert, Delivery, JobLock, PushSubscription, Rate, SendDay, Settings, getSettings } from '../src/models';
import { raiseAlert, setAlertNotifier } from '../src/services/alerts';
import { notifyAdmins, setMailTransport, type Mail } from '../src/services/notify';
import { setPushTransport, type PushSub } from '../src/services/push';
import { attemptSend, tick } from '../src/services/scheduler';
import { markPosted, remindPendingManual, staffToday } from '../src/services/staff';
import { createStorage } from '../src/services/storage';
import { login, makeUser, startTestApp, stopTestApp, testConfig } from './setup';

const istAt = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
/** Move the fake clock to an IST instant and return it (keeps createdAt timestamps consistent with `now`). */
const ist = (date: string, time: string) => { const d = istAt(date, time); vi.setSystemTime(d); return d; };
const good = { k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [] as any[] };
const sub = (n: number): PushSub => ({ endpoint: `https://push.example/sub/${n}`, keys: { p256dh: 'p256dh-key-value-xxxx', auth: 'auth-key' } });

let app: any, admin: any, staff: any, viewer: any, deps: any;
let pushed: { endpoint: string; payload: any }[] = [];
let mails: Mail[] = [];
let deadEndpoints = new Set<string>();

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin'); await makeUser('staff@chheda.test', 'staff'); await makeUser('viewer@chheda.test', 'viewer');
  admin = await login(app, 'admin@chheda.test'); staff = await login(app, 'staff@chheda.test'); viewer = await login(app, 'viewer@chheda.test');
  setPushTransport(async (s, payload) => { if (deadEndpoints.has(s.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 }); pushed.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }); });
  setMailTransport(async (m) => { mails.push(m); });
});
afterAll(async () => { setPushTransport(null); setMailTransport(null); setAlertNotifier(null); await stopTestApp(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-18T06:00:00+05:30'));
  pushed = []; mails = []; deadEndpoints = new Set();
  await Promise.all([Rate.deleteMany({}), Delivery.deleteMany({}), Alert.deleteMany({}), SendDay.deleteMany({}), JobLock.deleteMany({}), PushSubscription.deleteMany({})]);
  const s = await getSettings();
  s.set({ automationOn: true, sendTime: '07:00', cutoffTime: '11:00', manualReminderMinutes: 30, ibja: { enabled: false }, channels: { igFeed: true, igStory: true, waCustomers: true, staffShare: true, rateKeywordReply: true }, adminAlerts: { emails: ['owner@chheda.test'], whatsappNumbers: [], templateName: 'admin_alert', templateLanguage: 'en' } });
  await s.save();
  const cfg = { ...testConfig, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
  deps = { cfg, storage: createStorage(cfg), sleep: async () => {} };
  setAlertNotifier(null, (id) => notifyAdmins(cfg, id));
});
afterEach(() => vi.useRealTimers());

const today = () => istDate();
const approve = (date = today()) => Rate.create({ date, ...good, status: 'approved', enteredBy: 'a', approvedBy: 'a', approvedAt: new Date() });

describe('push subscriptions', () => {
  it('staff/admin can save and remove a subscription; viewers cannot; validation applies', async () => {
    expect((await viewer.post('/api/v1/staff/push/subscribe', sub(1))).status).toBe(403);
    expect((await staff.post('/api/v1/staff/push/subscribe', { endpoint: 'nope' })).status).toBe(422);
    expect((await staff.post('/api/v1/staff/push/subscribe', sub(1))).status).toBe(201);
    expect((await staff.post('/api/v1/staff/push/subscribe', sub(1))).status).toBe(201); // idempotent on endpoint
    expect(await PushSubscription.countDocuments()).toBe(1);
    expect((await PushSubscription.findOne())!.role).toBe('staff');
    const key = await staff.get('/api/v1/staff/push/vapid-public-key');
    expect(key.body).toEqual({ publicKey: null, configured: false });
    expect((await admin.delete('/api/v1/staff/push/subscribe').send({ endpoint: sub(1).endpoint })).body.removed).toBe(false); // not the owner
    expect((await staff.delete('/api/v1/staff/push/subscribe').send({ endpoint: sub(1).endpoint })).body.removed).toBe(true);
    expect(await PushSubscription.countDocuments()).toBe(0);
  });
});

describe('manual tasks: timing, share page, mark posted', () => {
  it('no tasks and NO rate values before the send time, even when approved; tasks appear at send time with a push', async () => {
    await staff.post('/api/v1/staff/push/subscribe', sub(1));
    await approve();
    const before = await staff.get('/api/v1/staff/today');
    expect(before.body).toMatchObject({ ready: false, reason: 'before_send_time', sendTime: '07:00' });
    expect(JSON.stringify(before.body)).not.toMatch(/11,?250/);
    expect(await Delivery.countDocuments({ channel: /_manual$/ })).toBe(0);
    await tick(ist(today(), '07:00'), deps);
    expect(await Delivery.countDocuments({ channel: /_manual$/, status: 'pending_manual' })).toBe(3);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: "Today's gold rate is ready to share", url: `${testConfig.WEB_PUBLIC_URL}/staff` });
    const after = await staffToday(ist(today(), '07:01'));
    expect(after.ready).toBe(true);
    if (after.ready) {
      expect(after.tasks.map((t) => t.channel)).toEqual(['ig_broadcast_manual', 'wa_channel_manual', 'wa_community_manual']);
      expect(after.caption).toContain('₹11,250');
      expect(after.feedUrl).toMatch(/\.jpg$/);
    }
    // a re-run does not create duplicates or push again
    await tick(ist(today(), '07:15'), deps);
    expect(await Delivery.countDocuments({ channel: /_manual$/ })).toBe(3);
    expect(pushed).toHaveLength(1);
  });
  it('never shows an old rate: yesterday sent + tasks, today missing / draft / cancelled', async () => {
    const y = addDays(today(), -1);
    await Rate.create({ date: y, ...good, status: 'sent', enteredBy: 'a', creativeUrls: { feed: 'http://x/f.jpg', story: 'http://x/s.jpg' }, caption: 'OLD ₹11,250' });
    await Delivery.create({ date: y, channel: 'ig_broadcast_manual', trigger: 'cron', status: 'pending_manual', idempotencyKey: `${y}:ig_broadcast_manual`, creativeUrls: { feed: 'http://x/f.jpg', story: 'http://x/s.jpg' }, caption: 'OLD ₹11,250' });
    const none = await staffToday(ist(today(), '08:00'));
    expect(none).toMatchObject({ ready: false, reason: 'no_rate' });
    expect(JSON.stringify(none)).not.toMatch(/OLD|11,250|f\.jpg/);
    await Rate.create({ date: today(), ...good, status: 'draft', enteredBy: 'a', caption: 'NEW ₹11,250' });
    const draft = await staffToday(ist(today(), '08:00'));
    expect(draft).toMatchObject({ ready: false, reason: 'not_approved' });
    expect(JSON.stringify(draft)).not.toMatch(/11,250/);
    await Rate.updateOne({ date: today() }, { status: 'cancelled' });
    expect((await staffToday(ist(today(), '08:00'))).ready).toBe(false);
    expect(((await staffToday(ist(today(), '08:00'))) as any).reason).toBe('cancelled');
  });
  it('staff share OFF → no tasks, page explains', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'channels.staffShare': false });
    await approve();
    await tick(ist(today(), '07:00'), deps);
    expect(await Delivery.countDocuments({ channel: /_manual$/ })).toBe(0);
    expect(pushed).toHaveLength(0);
    expect((await staffToday(ist(today(), '07:05')) as any).reason).toBe('staff_share_off');
  });
  it('Mark posted: staff only, exactly once, recorded with who + when; admin dashboard sees it', async () => {
    await approve(); await tick(ist(today(), '07:00'), deps);
    const t = (await staff.get('/api/v1/staff/today')).body.tasks[0];
    expect((await viewer.post(`/api/v1/staff/tasks/${t.id}/mark-posted`)).status).toBe(403);
    vi.setSystemTime(ist(today(), '07:12'));
    const ok = await staff.post(`/api/v1/staff/tasks/${t.id}/mark-posted`);
    expect(ok.status).toBe(200);
    expect(ok.body.task).toMatchObject({ status: 'success', postedBy: 'staff@chheda.test', channel: 'ig_broadcast_manual' });
    expect(new Date(ok.body.task.postedAt).toISOString()).toBe(ist(today(), '07:12').toISOString());
    expect((await staff.post(`/api/v1/staff/tasks/${t.id}/mark-posted`)).status).toBe(409);
    expect((await admin.post(`/api/v1/deliveries/${t.id}/mark-posted`)).status).toBe(409);
    const dash = await admin.get(`/api/v1/deliveries?date=${today()}`);
    const row = dash.body.items.find((i: any) => i.id === t.id);
    expect(row).toMatchObject({ status: 'success', postedBy: 'staff@chheda.test' });
    expect(dash.body.items.filter((i: any) => i.status === 'pending_manual')).toHaveLength(2);
    expect((await staff.post(`/api/v1/staff/tasks/${'0'.repeat(24)}/mark-posted`)).status).toBe(404);
    // an automatic channel row cannot be "marked posted"
    const auto = await Delivery.findOne({ date: today(), channel: 'ig_feed' });
    await expect(markPosted(String(auto!._id), { email: 'staff@chheda.test', role: 'staff' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('30-minute reminder', () => {
  it('reminds once per task after the configured delay, alerts the admin, and stops once posted', async () => {
    await staff.post('/api/v1/staff/push/subscribe', sub(1));
    await approve(); await tick(ist(today(), '07:00'), deps);
    pushed = []; mails = [];
    expect((await tick(ist(today(), '07:29'), deps) as any).reminders).toBeUndefined();
    const tasks = await Delivery.find({ date: today(), channel: /_manual$/ });
    await markPosted(String(tasks[0]._id), { email: 'staff@chheda.test', role: 'staff' }, ist(today(), '07:20'));
    const r = await tick(ist(today(), '07:30'), deps);
    expect((r as any).reminders).toBe(2);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload.title).toMatch(/Reminder/);
    expect(pushed[0].payload.body).toMatch(/wa channel, wa community/);
    expect(await Alert.countDocuments({ type: 'manual_pending', date: today() })).toBe(2);
    expect(mails.map((m) => m.subject).join()).toMatch(/Staff share still pending/);
    // no second reminder
    await tick(ist(today(), '07:45'), deps);
    expect(pushed).toHaveLength(1);
    expect(await Alert.countDocuments({ type: 'manual_pending' })).toBe(2);
  });
  it('respects a custom delay from settings', async () => {
    await Settings.updateOne({ _id: 'main' }, { manualReminderMinutes: 10 });
    await approve(); await attemptSend(today(), ist(today(), '07:00'), 'cron', deps);
    expect((await remindPendingManual(deps.cfg, ist(today(), '07:09'))).reminded).toBe(0);
    expect((await remindPendingManual(deps.cfg, ist(today(), '07:10'))).reminded).toBe(3);
  });
  it('dead push endpoints are removed automatically', async () => {
    await staff.post('/api/v1/staff/push/subscribe', sub(1));
    await staff.post('/api/v1/staff/push/subscribe', sub(2));
    deadEndpoints.add(sub(2).endpoint);
    await approve(); await tick(ist(today(), '07:00'), deps);
    expect(pushed.map((p) => p.endpoint)).toEqual([sub(1).endpoint]);
    expect(await PushSubscription.countDocuments()).toBe(1);
  });
});

describe('admin alert notifications', () => {
  it('every alert type fans out to email (+ WhatsApp in DRY_RUN is logged) and is recorded on the alert', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'adminAlerts.whatsappNumbers': [{ enc: 'x', masked: '+91••••••0000' }] });
    const r = await raiseAlert({ type: 'rate_missing', severity: 'critical', date: today(), dedupeKey: `t:${Date.now()}`, message: 'Nothing was sent' });
    expect(r.created).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: 'owner@chheda.test', subject: expect.stringMatching(/rate missing/i) });
    expect(mails[0].text).toContain('Nothing was sent');
    expect(mails[0].text).toContain(`${testConfig.WEB_PUBLIC_URL}/alerts`);
    const a = await Alert.findById(r.alert!._id);
    expect(a!.notifiedAt).toBeTruthy();
    expect(a!.notifications.map((n: any) => `${n.channel}:${n.status}`)).toEqual(['email:sent', 'whatsapp:dry_run']);
    const list = await admin.get(`/api/v1/alerts?type=rate_missing&date=${today()}`);
    expect(list.body.items[0].notifications).toHaveLength(2);
  });
  it('de-duplicates: same type + date at most once per 30 minutes, different date/type still notifies', async () => {
    await raiseAlert({ type: 'send_failed', date: today(), message: 'one' });
    vi.setSystemTime(ist(today(), '06:20'));
    await raiseAlert({ type: 'send_failed', date: today(), message: 'two' });
    expect(mails).toHaveLength(1);
    await raiseAlert({ type: 'send_failed', date: addDays(today(), 1), message: 'other day' });
    await raiseAlert({ type: 'partial_send', date: today(), message: 'other type' });
    expect(mails).toHaveLength(3);
    vi.setSystemTime(ist(today(), '06:31'));
    await raiseAlert({ type: 'send_failed', date: today(), message: 'three' });
    expect(mails).toHaveLength(4);
    const skipped = await Alert.findOne({ message: 'two' });
    expect(skipped!.notifiedAt).toBeUndefined();
    expect(skipped!.notifications[0]).toMatchObject({ channel: 'dedupe', status: 'skipped' });
  });
  it('a partial send raises partial_send and a full failure raises send_failed', async () => {
    await approve();
    const fail = { publish: async () => { throw new Error('boom'); }, channel: 'ig_story' } as any;
    const ok = { publish: async () => ({ externalId: 'x' }), channel: 'ig_feed' } as any;
    await attemptSend(today(), ist(today(), '07:00'), 'cron', { ...deps, publishers: { ig_feed: ok, ig_story: fail, wa_customers: { ...ok, channel: 'wa_customers' } } });
    expect(await Alert.countDocuments({ type: 'partial_send', date: today() })).toBe(1);
    await Rate.updateOne({ date: today() }, { status: 'approved' }); await Delivery.deleteMany({}); await SendDay.deleteMany({});
    await attemptSend(today(), ist(today(), '08:00'), 'send_now', { ...deps, publishers: { ig_feed: fail, ig_story: fail, wa_customers: fail } });
    expect(await Alert.countDocuments({ type: 'send_failed', date: today() })).toBe(1);
  });
  it('without SMTP the email is skipped but recorded; alerts endpoints expose count + filters', async () => {
    setMailTransport(null);
    const cfg = { ...deps.cfg, SMTP_HOST: undefined };
    setAlertNotifier(null, (id) => notifyAdmins(cfg, id));
    await raiseAlert({ type: 'day_skipped', date: today(), message: 'x' });
    const a = await Alert.findOne({ type: 'day_skipped' });
    expect(a!.notifications[0]).toMatchObject({ channel: 'email', status: 'skipped' });
    setMailTransport(async (m) => { mails.push(m); });
    expect((await staff.get('/api/v1/alerts/count')).body.open).toBe(1);
    expect((await admin.get('/api/v1/alerts?status=open&type=day_skipped')).body.items).toHaveLength(1);
    expect((await admin.get('/api/v1/alerts?type=bogus')).status).toBe(422);
  });
  it('settings: admin numbers are stored encrypted and echoed masked; reminder minutes validated', async () => {
    const r = await admin.put('/api/v1/settings', { manualReminderMinutes: 45, adminAlerts: { emails: ['owner@chheda.test', 'second@chheda.test'], whatsappNumbers: ['+91 98765 43210'] } });
    expect(r.status).toBe(200);
    expect(r.body.settings.adminAlerts.whatsappNumbers).toEqual(['+91••••••3210']);
    expect(r.body.settings.manualReminderMinutes).toBe(45);
    expect(JSON.stringify(r.body)).not.toContain('9876543210');
    const stored = await Settings.findById('main').lean();
    expect((stored as any).adminAlerts.whatsappNumbers[0].enc).not.toContain('9876543210');
    // echoing the masked value back keeps the stored number; adding a bad one is rejected
    const keep = await admin.put('/api/v1/settings', { adminAlerts: { whatsappNumbers: ['+91••••••3210'] } });
    expect(keep.body.settings.adminAlerts.whatsappNumbers).toEqual(['+91••••••3210']);
    expect((await admin.put('/api/v1/settings', { adminAlerts: { whatsappNumbers: ['12'] } })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { manualReminderMinutes: 2 })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { adminAlerts: { emails: ['nope'] } })).status).toBe(422);
  });
});
