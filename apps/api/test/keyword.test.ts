import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { addDays, istDate } from '@chheda/shared';
import { Alert, Delivery, Integration, Rate, Settings, Subscriber, WebhookEvent, getSettings } from '../src/models';
import { setAlertNotifier } from '../src/services/alerts';
import { saveIntegration } from '../src/services/integrations';
import { handleKeywordMessage, type InboundMessage } from '../src/services/keywordReply';
import { createStorage } from '../src/services/storage';
import { processInstagramEvent, processWhatsAppEvent } from '../src/services/webhooks';
import { lookupHash } from '../src/lib/crypto';
import { login, makeUser, startTestApp, stopTestApp, testConfig, TEST_APP_SECRET } from './setup';

type Handler = (url: URL, body: any) => any;
function mockFetch(routes: [RegExp, Handler][]) {
  const calls: { method: string; url: string; body?: any; auth?: string }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url); const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? 'GET', url, body, auth: (init.headers as any)?.Authorization });
    const route = routes.find(([re]) => re.test(`${init.method ?? 'GET'} ${u.pathname}`));
    if (!route) return new Response(JSON.stringify({ error: { message: `no mock for ${init.method} ${u.pathname}`, code: 100 } }), { status: 400 });
    const out = await route[1](u, body);
    if (out && typeof out === 'object' && 'status' in out && 'body' in out) return new Response(JSON.stringify(out.body), { status: out.status });
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { fn, calls };
}
const good = { k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [{ label: '14K', value: 6560 }] };
let app: any, admin: any, deps: any, liveDeps: any, m: ReturnType<typeof mockFetch>;
const NOW = new Date('2026-09-18T09:00:00+05:30');
const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({ channel: 'whatsapp', senderId: '+919876500001', messageId: `wamid.${crypto.randomUUID()}`, text: 'rate', sentAt: NOW.getTime() - 60_000, ...over });

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin');
  admin = await login(app, 'admin@chheda.test');
  setAlertNotifier(null, async () => {});
  await saveIntegration('whatsapp', { accessToken: 'WA_LIVE_TOKEN_1234567890', accountId: '555', phoneNumberId: 'PHONE1' }, 'admin');
  await saveIntegration('instagram', { accessToken: 'IG_LIVE_TOKEN_1234567890', accountId: '1789' }, 'admin');
  await Integration.updateMany({}, { status: 'connected' });
});
afterAll(async () => { setAlertNotifier(null); await stopTestApp(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  await Promise.all([Rate.deleteMany({}), Delivery.deleteMany({}), Alert.deleteMany({}), WebhookEvent.deleteMany({}), Subscriber.deleteMany({})]);
  const s = await getSettings();
  s.set({ 'channels.rateKeywordReply': true, keywordReply: { triggers: ['rate', 'gold rate', 'rate today', 'today rate', 'aaj ka rate', 'bhav'], maxPerSenderPerDay: 3, notReadyMessage: "Today's gold rate will be updated shortly – please check back." }, whatsapp: { templateName: 'daily_gold_rate', templateLanguage: 'en', includeExtrasParam: false } });
  await s.save();
  m = mockFetch([
    [/POST .*\/PHONE1\/messages/, (_u, b) => ({ messages: [{ id: `wamid.out.${crypto.createHash('md5').update(JSON.stringify(b)).digest('hex').slice(0, 8)}` }] })],
    [/POST .*\/1789\/messages/, () => ({ recipient_id: 'x', message_id: `mid.out.${crypto.randomUUID().slice(0, 8)}` })],
  ]);
  deps = { cfg: testConfig, storage: createStorage(testConfig), fetchFn: m.fn, now: NOW };
  const live = { ...testConfig, DRY_RUN: false };
  liveDeps = { cfg: live, storage: createStorage(live), fetchFn: m.fn, now: NOW };
});
afterEach(() => vi.useRealTimers());
const today = () => istDate(NOW);

describe('matching + safeguards', () => {
  it('replies only to trigger words (case, spaces, punctuation, Hinglish) and never to other messages', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    let n = 0;
    for (const t of ['RATE', ' gold   rate!! ', 'Aaj ka rate?', 'bhav']) expect((await handleKeywordMessage(msg({ text: t, senderId: `+91987650010${n++}` }), liveDeps)).action, t).toBe('replied');
    for (const t of ['hello', 'what is the rate for 22k bangles', 'rates', undefined]) expect((await handleKeywordMessage(msg({ text: t }), liveDeps)).action, String(t)).toBe('no_match');
    expect(await Delivery.countDocuments({ trigger: 'keyword' })).toBe(4);
  });
  it('feature off → no reply, no row; configured trigger list is respected', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'channels.rateKeywordReply': false });
    expect((await handleKeywordMessage(msg(), liveDeps)).action).toBe('feature_off');
    expect(await Delivery.countDocuments()).toBe(0);
    await Settings.updateOne({ _id: 'main' }, { 'channels.rateKeywordReply': true, 'keywordReply.triggers': ['sona'] });
    expect((await handleKeywordMessage(msg({ text: 'rate' }), liveDeps)).action).toBe('no_match');
    expect((await handleKeywordMessage(msg({ text: 'SONA' }), liveDeps)).action).toBe('replied');
  });
  it('duplicate webhook delivery (same message id) never replies twice', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const one = msg({ messageId: 'wamid.same' });
    expect((await handleKeywordMessage(one, liveDeps)).action).toBe('replied');
    expect((await handleKeywordMessage(one, liveDeps)).action).toBe('duplicate');
    expect(m.calls.filter((c) => c.url.includes('/PHONE1/messages'))).toHaveLength(1);
    expect(await Delivery.countDocuments({ trigger: 'keyword' })).toBe(1);
  });
  it('per-sender daily limit stops the loop; other senders unaffected; resets next day', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    for (let i = 0; i < 3; i++) expect((await handleKeywordMessage(msg(), liveDeps)).action).toBe('replied');
    const fourth = await handleKeywordMessage(msg(), liveDeps);
    expect(fourth.action).toBe('limit_reached');
    expect((await Delivery.findById((fourth as any).deliveryId))!.status).toBe('skipped');
    expect((await handleKeywordMessage(msg({ senderId: '+919876500002' }), liveDeps)).action).toBe('replied');
    expect(m.calls.filter((c) => c.url.includes('/PHONE1/messages'))).toHaveLength(4);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    await Rate.create({ date: addDays(today(), 1), ...good, status: 'approved', enteredBy: 'a' });
    expect((await handleKeywordMessage(msg({ sentAt: tomorrow.getTime() - 1000 }), { ...liveDeps, now: tomorrow })).action).toBe('replied');
  });
});

describe('reply content', () => {
  it('approved rate → image + caption with the exact admin values', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const r = await handleKeywordMessage(msg(), liveDeps);
    expect(r).toMatchObject({ action: 'replied', kind: 'rate', mode: 'freeform' });
    const call = m.calls.find((c) => c.url.includes('/PHONE1/messages'))!;
    expect(call.body.type).toBe('image');
    expect(call.body.to).toBe('919876500001');
    expect(call.body.image.link).toMatch(/\/media\/creative\/.*feed-.*\.jpg$/);
    expect(call.body.image.caption).toContain('24K: ₹11,250 /g');
    expect(call.body.image.caption).toContain('22K: ₹10,305.5 /g');
    expect(call.body.image.caption).toContain('14K: ₹6,560 /g');
    const row = await Delivery.findOne({ trigger: 'keyword' });
    expect(row).toMatchObject({ channel: 'wa_keyword', status: 'success', recipientMasked: '+91••••••0001', recipientHash: lookupHash('whatsapp:+919876500001'), dryRun: false });
    expect(row!.externalId).toMatch(/^wamid\.out\./);
    expect(JSON.stringify(row!.toObject())).not.toContain('9876500001');
  });
  it('not approved (draft / missing / yesterday only) → "check back" text with NO rate values anywhere', async () => {
    await Rate.create({ date: addDays(today(), -1), ...good, status: 'sent', enteredBy: 'a', caption: 'OLD 11,250' });
    await Rate.create({ date: today(), ...good, status: 'draft', enteredBy: 'a' });
    const r = await handleKeywordMessage(msg(), liveDeps);
    expect(r).toMatchObject({ action: 'replied', kind: 'not_ready' });
    const call = m.calls.find((c) => c.url.includes('/PHONE1/messages'))!;
    expect(call.body).toEqual({ messaging_product: 'whatsapp', to: '919876500001', type: 'text', text: { body: "Today's gold rate will be updated shortly – please check back." } });
    expect(JSON.stringify(call.body)).not.toMatch(/11,?250|10,?305|8,?437|OLD/);
    const row = await Delivery.findOne({ trigger: 'keyword' });
    expect(row!.rateSnapshot?.k24).toBeUndefined();
    expect(row!.creativeUrls?.feed).toBeUndefined();
  });
  it('WhatsApp: window closed → approved template instead of free-form; not ready + closed → skipped', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const old = msg({ sentAt: NOW.getTime() - 25 * 3600_000 });
    const r = await handleKeywordMessage(old, liveDeps);
    expect(r).toMatchObject({ action: 'replied', kind: 'rate', mode: 'template' });
    const call = m.calls.find((c) => c.url.includes('/PHONE1/messages'))!;
    expect(call.body.type).toBe('template');
    expect(call.body.template.name).toBe('daily_gold_rate');
    expect(call.body.template.components[1].parameters.map((p: any) => p.text)).toEqual(['Fri, 18 Sept 2026', '₹11,250', '₹10,305.5', '₹8,437']);
    await Rate.deleteMany({}); m.calls.length = 0;
    const r2 = await handleKeywordMessage(msg({ sentAt: NOW.getTime() - 25 * 3600_000 }), liveDeps);
    expect(r2.action).toBe('skipped');
    expect(m.calls).toHaveLength(0);
  });
  it('Instagram: image then caption via the Messaging API; window closed → skipped', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const r = await handleKeywordMessage(msg({ channel: 'instagram', senderId: '1234567890123', messageId: 'mid.1' }), liveDeps);
    expect(r).toMatchObject({ action: 'replied', kind: 'rate' });
    const calls = m.calls.filter((c) => c.url.includes('/1789/messages'));
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({ recipient: { id: '1234567890123' }, message: { attachment: { type: 'image' } } });
    expect(calls[1].body.message.text).toContain('₹11,250');
    expect(calls[0].auth).toBe('Bearer IG_LIVE_TOKEN_1234567890');
    const row = await Delivery.findOne({ channel: 'ig_keyword' });
    expect(row).toMatchObject({ status: 'success', recipientMasked: 'ig:…0123' });
    expect((await handleKeywordMessage(msg({ channel: 'instagram', senderId: '1234567890123', messageId: 'mid.2', sentAt: NOW.getTime() - 25 * 3600_000 }), liveDeps)).action).toBe('skipped');
  });
  it('DRY_RUN → logged, row with dry-run id, no HTTP', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const r = await handleKeywordMessage(msg(), deps);
    expect(r).toMatchObject({ action: 'replied', kind: 'rate' });
    expect(m.calls).toHaveLength(0);
    expect((await Delivery.findOne({ trigger: 'keyword' }))!.externalId).toMatch(/^dry-run:wa_keyword:/);
  });
  it('a Meta failure is recorded, alerted and never thrown', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const bad = mockFetch([[/messages/, () => ({ status: 400, body: { error: { message: 'Recipient unavailable', code: 131026 } } })]]);
    const r = await handleKeywordMessage(msg(), { ...liveDeps, fetchFn: bad.fn });
    expect(r).toMatchObject({ action: 'failed', error: /Recipient unavailable/ });
    expect(await Delivery.findOne({ trigger: 'keyword' })).toMatchObject({ status: 'failed', metaErrorCode: 131026 });
    expect(await Alert.countDocuments({ type: 'keyword_reply_failed', date: today() })).toBe(1);
  });
});

describe('webhook integration', () => {
  const sign = (body: string) => `sha256=${crypto.createHmac('sha256', TEST_APP_SECRET).update(body).digest('hex')}`;
  const waEvent = (messages: any[]) => ({ object: 'whatsapp_business_account', entry: [{ id: '555', changes: [{ value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PHONE1' }, messages }, field: 'messages' }] }] });
  const text = (id: string, body: string, from = '919876511111') => ({ from, id, timestamp: String(Math.floor(NOW.getTime() / 1000) - 30), type: 'text', text: { body } });
  it('WhatsApp: RATE replies, JOIN/STOP still work and never trigger a rate reply, keyword never opts anyone in', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const s = await processWhatsAppEvent(waEvent([text('m1', 'Rate'), text('m2', 'JOIN'), text('m3', 'hello'), text('m4', 'STOP')]), liveDeps.cfg, m.fn, { storage: liveDeps.storage, now: NOW });
    expect(s).toMatchObject({ messages: 4, joins: 1, stops: 1, rateKeyword: 1, keywordReplies: 1 });
    expect(await Delivery.countDocuments({ trigger: 'keyword' })).toBe(1);
    expect(await Subscriber.countDocuments()).toBe(1); // from JOIN only
    expect((await Subscriber.findOne())!.status).toBe('opted_out');
    // redelivery of the same webhook → all duplicates, nothing sent again
    const before = m.calls.length;
    const again = await processWhatsAppEvent(waEvent([text('m1', 'Rate')]), liveDeps.cfg, m.fn, { storage: liveDeps.storage, now: NOW });
    expect(again.duplicates).toBe(1);
    expect(m.calls.length).toBe(before);
  });
  it('Instagram: DM with a trigger word gets a reply; echoes and non-matches do not; duplicates ignored', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const ev = { object: 'instagram', entry: [{ id: '1789', time: NOW.getTime(), messaging: [
      { sender: { id: '9001' }, recipient: { id: '1789' }, timestamp: NOW.getTime() - 5000, message: { mid: 'mid.a', text: 'gold rate' } },
      { sender: { id: '1789' }, recipient: { id: '9001' }, timestamp: NOW.getTime() - 4000, message: { mid: 'mid.echo', text: 'gold rate', is_echo: true } },
      { sender: { id: '9002' }, recipient: { id: '1789' }, timestamp: NOW.getTime() - 3000, message: { mid: 'mid.b', text: 'do you have bangles?' } },
    ] }] };
    const s = await processInstagramEvent(ev, liveDeps.cfg, m.fn, { storage: liveDeps.storage, now: NOW });
    expect(s).toMatchObject({ stored: 3, messages: 2, rateKeyword: 1, keywordReplies: 1 });
    expect(await Delivery.countDocuments({ channel: 'ig_keyword', status: 'success' })).toBe(1);
    const s2 = await processInstagramEvent(ev, liveDeps.cfg, m.fn, { storage: liveDeps.storage, now: NOW });
    expect(s2.duplicates).toBe(3);
  });
  it('HTTP: signed webhook is accepted and processed asynchronously (200 first)', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    const body = JSON.stringify(waEvent([text('m9', 'bhav')]));
    const r = await request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sign(body)).send(body);
    expect(r.status).toBe(200);
    await vi.waitFor(async () => expect(await Delivery.countDocuments({ trigger: 'keyword', status: 'success' })).toBe(1), { timeout: 5000, interval: 50 });
    expect((await Delivery.findOne({ trigger: 'keyword' }))!.externalId).toMatch(/^dry-run:/); // app runs DRY_RUN
  });
});

describe('dashboard + settings', () => {
  it('keyword log endpoint returns today count and masked senders', async () => {
    await Rate.create({ date: today(), ...good, status: 'approved', enteredBy: 'a' });
    await handleKeywordMessage(msg(), deps); await handleKeywordMessage(msg({ senderId: '+919876500002' }), deps);
    const r = await admin.get('/api/v1/deliveries/keyword');
    expect(r.status).toBe(200);
    expect(r.body.todayCount).toBe(2);
    expect(r.body.items.map((i: any) => i.recipientMasked).sort()).toEqual(['+91••••••0001', '+91••••••0002']);
    expect(JSON.stringify(r.body)).not.toMatch(/98765000/);
  });
  it('settings validate triggers, limit and the not-ready message', async () => {
    const ok = await admin.put('/api/v1/settings', { keywordReply: { triggers: [' Rate ', 'Gold Rate!', 'sona'], maxPerSenderPerDay: 5, notReadyMessage: 'Rate will be updated soon, please check back.' } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.keywordReply).toMatchObject({ triggers: ['rate', 'gold rate', 'sona'], maxPerSenderPerDay: 5 });
    expect((await admin.put('/api/v1/settings', { keywordReply: { triggers: [] } })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { keywordReply: { triggers: ['stop'] } })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { keywordReply: { maxPerSenderPerDay: 0 } })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { keywordReply: { notReadyMessage: 'Today 24K is ₹11250' } })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { keywordReply: { notReadyMessage: 'short' } })).status).toBe(422);
  });
});
