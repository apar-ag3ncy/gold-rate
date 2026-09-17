import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { istDate } from '@chheda/shared';
import { Alert, AuditLog, Delivery, Integration, Rate, SendDay, Subscriber, WebhookEvent, JobLock } from '../src/models';
import { MetaClient, PublishError } from '../src/services/meta/client';
import { InstagramPublisher } from '../src/services/publishers/instagram';
import { WhatsAppPublisher } from '../src/services/publishers/whatsapp';
import { checkIntegrationsHealth, saveIntegration, testConnection } from '../src/services/integrations';
import { processWhatsAppEvent, verifySignature } from '../src/services/webhooks';
import { attemptSend } from '../src/services/scheduler';
import { createStorage } from '../src/services/storage';
import { decrypt, lookupHash } from '../src/lib/crypto';
import { login, makeUser, startTestApp, stopTestApp, testConfig, TEST_APP_SECRET } from './setup';

/** Route-matching fetch mock. Handlers get (url, init) and return a JSON body (or throw / return {status, body}). */
type Handler = (url: URL, init: RequestInit) => any;
function mockFetch(routes: [RegExp, Handler][]) {
  const calls: { method: string; url: string; body?: any; auth?: string }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? 'GET', url, body, auth: (init.headers as any)?.Authorization });
    const route = routes.find(([re]) => re.test(`${init.method ?? 'GET'} ${u.pathname}`));
    if (!route) return new Response(JSON.stringify({ error: { message: `no mock for ${init.method} ${u.pathname}`, code: 100 } }), { status: 400 });
    const out = await route[1](u, init);
    if (out && typeof out === 'object' && 'status' in out && 'body' in out) return new Response(JSON.stringify(out.body), { status: out.status });
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { fn, calls };
}
const noSleep = async () => {};
const rate = { k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [{ label: '14K', value: 6560 }] };
const payload = { date: '2026-09-18', feedUrl: 'http://x/feed.jpg', storyUrl: 'http://x/story.jpg', caption: 'cap', rate };

let app: any;
let admin: Awaited<ReturnType<typeof login>>;
let staff: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin');
  await makeUser('staff@chheda.test', 'staff');
  admin = await login(app, 'admin@chheda.test');
  staff = await login(app, 'staff@chheda.test');
});
afterAll(stopTestApp);
beforeEach(async () => { await Promise.all([Delivery.deleteMany({}), Subscriber.deleteMany({}), WebhookEvent.deleteMany({}), Alert.deleteMany({}), JobLock.deleteMany({})]); });

// ---------------------------------------------------------------- Instagram
describe('Instagram publisher (mocked Graph API)', () => {
  const creds = { igUserId: '1789', accessToken: 'IGTOKEN' };
  it('checks the limit, creates a container, polls until FINISHED, publishes and returns the media id', async () => {
    let polls = 0;
    const m = mockFetch([
      [/GET \/v\d+\.\d+\/1789\/content_publishing_limit/, () => ({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] })],
      [/POST \/v\d+\.\d+\/1789\/media$/, () => ({ id: 'c1' })],
      [/GET \/v\d+\.\d+\/c1/, () => ({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' })],
      [/POST \/v\d+\.\d+\/1789\/media_publish/, () => ({ id: 'media_42' })],
    ]);
    const slept: number[] = [];
    const pub = new InstagramPublisher('ig_feed', new MetaClient(testConfig, m.fn), creds, { sleep: async (ms) => { slept.push(ms); }, pollBaseMs: 2000 });
    const r = await pub.publish(payload);
    expect(r.externalId).toBe('media_42');
    expect(slept).toEqual([2000, 4000]);
    const create = m.calls.find((c) => c.url.endsWith('/1789/media'))!;
    expect(create.body).toEqual({ image_url: 'http://x/feed.jpg', caption: 'cap' });
    expect(create.auth).toBe('Bearer IGTOKEN');
    expect(m.calls.find((c) => c.url.endsWith('/media_publish'))!.body).toEqual({ creation_id: 'c1' });
    expect(m.calls[0].url).toMatch(new RegExp(`/${testConfig.META_GRAPH_VERSION}/`));
  });
  it('story uses media_type=STORIES and no caption', async () => {
    const m = mockFetch([
      [/content_publishing_limit/, () => ({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] })],
      [/POST .*\/media$/, () => ({ id: 'c2' })], [/GET .*\/c2/, () => ({ status_code: 'FINISHED' })], [/media_publish/, () => ({ id: 'story_7' })],
    ]);
    const r = await new InstagramPublisher('ig_story', new MetaClient(testConfig, m.fn), creds, { sleep: noSleep }).publish(payload);
    expect(r.externalId).toBe('story_7');
    expect(m.calls.find((c) => c.url.endsWith('/media'))!.body).toEqual({ image_url: 'http://x/story.jpg', media_type: 'STORIES' });
  });
  it('a container that never finishes → retryable error after the timeout', async () => {
    const m = mockFetch([
      [/content_publishing_limit/, () => ({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] })],
      [/POST .*\/media$/, () => ({ id: 'c3' })], [/GET .*\/c3/, () => ({ status_code: 'IN_PROGRESS' })],
    ]);
    const pub = new InstagramPublisher('ig_feed', new MetaClient(testConfig, m.fn), creds, { sleep: noSleep, timeoutMs: 10_000, pollBaseMs: 2000 });
    await expect(pub.publish(payload)).rejects.toMatchObject({ name: 'PublishError', retryable: true, message: /still IN_PROGRESS after 10 s/ });
    expect(m.calls.some((c) => c.url.endsWith('/media_publish'))).toBe(false);
  });
  it('publishing limit reached → clear, non-retryable error and no container is created', async () => {
    const m = mockFetch([[/content_publishing_limit/, () => ({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] })]]);
    await expect(new InstagramPublisher('ig_feed', new MetaClient(testConfig, m.fn), creds, { sleep: noSleep }).publish(payload))
      .rejects.toMatchObject({ retryable: false, message: /limit reached \(100\/100/ });
    expect(m.calls).toHaveLength(1);
  });
  it('maps Graph errors: invalid token is permanent, throttling is retryable', async () => {
    const bad = mockFetch([[/content_publishing_limit/, () => ({ status: 400, body: { error: { message: 'Invalid OAuth access token', code: 190 } } })]]);
    await expect(new InstagramPublisher('ig_feed', new MetaClient(testConfig, bad.fn), creds).publish(payload)).rejects.toMatchObject({ name: 'MetaApiError', retryable: false, code: 190 });
    const throttled = mockFetch([[/content_publishing_limit/, () => ({ status: 400, body: { error: { message: 'Too many calls', code: 4 } } })]]);
    await expect(new InstagramPublisher('ig_feed', new MetaClient(testConfig, throttled.fn), creds).publish(payload)).rejects.toMatchObject({ retryable: true, code: 4 });
  });
});

// ---------------------------------------------------------------- WhatsApp
async function seedSubscribers() {
  const { optIn, optOut } = await import('../src/services/subscribers');
  await optIn('+919876500001', 'in_store');
  await optIn('+919876500002', 'website');
  await optIn('+919876500003', 'import');
  await optIn('+919876500004', 'manual'); await optOut('+919876500004');
  const inv = await optIn('+919876500005', 'manual'); await Subscriber.updateOne({ _id: inv.subscriber._id }, { status: 'invalid' });
}
const waRoutes = (fail: Record<string, { code: number; msg: string }>): [RegExp, Handler][] => [[/POST .*\/PHONE1\/messages/, (_u, init) => {
  const b = JSON.parse(String(init.body));
  const f = fail[b.to];
  if (f) return { status: 400, body: { error: { message: f.msg, code: f.code } } };
  return { messaging_product: 'whatsapp', messages: [{ id: `wamid.${crypto.createHash('md5').update(b.to).digest('hex')}` }] };
}]];

describe('WhatsApp publisher (mocked Cloud API)', () => {
  const tpl = { templateName: 'daily_gold_rate', templateLanguage: 'en', includeExtrasParam: true };
  const creds = { phoneNumberId: 'PHONE1', accessToken: 'WATOKEN' };
  it('sends the template to every ACTIVE subscriber with the exact values; opted-out and invalid are skipped', async () => {
    await seedSubscribers();
    const m = mockFetch(waRoutes({}));
    const r = await new WhatsAppPublisher(new MetaClient(testConfig, m.fn), creds, tpl, { sleep: noSleep, delayMs: 0 }).publish({ ...payload });
    expect(r.stats).toEqual({ total: 3, sent: 3, failed: 0, skipped: 0 });
    expect(m.calls).toHaveLength(3);
    const sentTo = m.calls.map((c) => c.body.to).sort();
    expect(sentTo).toEqual(['919876500001', '919876500002', '919876500003']);
    const body = m.calls[0].body;
    expect(body.template.name).toBe('daily_gold_rate');
    expect(body.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'http://x/feed.jpg' } }] });
    expect(body.template.components[1].parameters.map((p: any) => p.text)).toEqual(['Fri, 18 Sept 2026', '₹11,250', '₹10,305.5', '₹8,437', '14K ₹6,560/g']);
    const rows = await Delivery.find({ date: '2026-09-18', recipientHash: { $exists: true } });
    expect(rows).toHaveLength(3);
    expect(rows.every((d) => d.status === 'success' && d.externalId?.startsWith('wamid.') && d.idempotencyKey === `2026-09-18:wa_cloud:${d.recipientHash}`)).toBe(true);
    expect(JSON.stringify(rows.map((d) => d.toObject()))).not.toContain('9876500001'); // never the full number
  });
  it('partial failure: permanent error marks the subscriber invalid; a retry never double-sends', async () => {
    await seedSubscribers();
    const m = mockFetch(waRoutes({ '919876500002': { code: 131026, msg: 'Message undeliverable' }, '919876500003': { code: 130429, msg: 'Rate limit hit' } }));
    const pub = new WhatsAppPublisher(new MetaClient(testConfig, m.fn), creds, tpl, { sleep: noSleep, delayMs: 0 });
    const r1 = await pub.publish({ ...payload });
    expect(r1.stats).toEqual({ total: 3, sent: 1, failed: 2, skipped: 0 });
    const bad = await Subscriber.findOne({ phoneHash: lookupHash('+919876500002') });
    expect(bad!.status).toBe('invalid');
    const failedRow = await Delivery.findOne({ recipientHash: lookupHash('+919876500002') });
    expect(failedRow).toMatchObject({ status: 'failed', metaErrorCode: 131026, retryable: false });
    expect(failedRow!.metaErrorMessage).toMatch(/undeliverable/);
    const queued = await Delivery.findOne({ recipientHash: lookupHash('+919876500003') });
    expect(queued).toMatchObject({ status: 'queued', attempts: 1, retryable: true, metaErrorCode: 130429 });
    // retry: the rate-limited one goes through, the successful one is skipped, the invalid one is no longer active
    const m2 = mockFetch(waRoutes({}));
    const r2 = await new WhatsAppPublisher(new MetaClient(testConfig, m2.fn), creds, tpl, { sleep: noSleep, delayMs: 0 }).publish({ ...payload });
    expect(r2.stats).toEqual({ total: 2, sent: 1, failed: 0, skipped: 1 });
    expect(m2.calls.map((c) => c.body.to)).toEqual(['919876500003']);
    expect(await Delivery.countDocuments({ recipientHash: { $exists: true } })).toBe(3);
  });
  it('throttles with a concurrency limit', async () => {
    await seedSubscribers();
    let inFlight = 0, maxInFlight = 0;
    const m = mockFetch([[/messages/, async (_u, init) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return { messages: [{ id: `wamid.${JSON.parse(String(init.body)).to}` }] }; }]]);
    await new WhatsAppPublisher(new MetaClient(testConfig, m.fn), creds, tpl, { concurrency: 1, delayMs: 0, sleep: noSleep }).publish({ ...payload });
    expect(maxInFlight).toBe(1);
  });
});

// ---------------------------------------------------------------- live pipeline
describe('scheduler pipeline in live mode', () => {
  it('uses the official publishers when DRY_RUN=false and integrations are connected; permanent errors are not retried', async () => {
    await Rate.deleteMany({}); await SendDay.deleteMany({});
    const today = istDate();
    await Rate.create({ date: today, ...rate, status: 'approved', enteredBy: 'a' });
    await saveIntegration('instagram', { accessToken: 'IG_LIVE_TOKEN_1234567890', accountId: '1789' }, 'admin');
    await saveIntegration('whatsapp', { accessToken: 'WA_LIVE_TOKEN_1234567890', accountId: '555', phoneNumberId: 'PHONE1' }, 'admin');
    await Integration.updateMany({}, { status: 'connected' });
    await seedSubscribers();
    let limitCalls = 0;
    const m = mockFetch([
      [/content_publishing_limit/, () => (++limitCalls === 1 ? { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } : { data: [{ quota_usage: 100, config: { quota_total: 100 } }] })],
      [/POST .*\/media$/, () => ({ id: 'c9' })], [/GET .*\/c9/, () => ({ status_code: 'FINISHED' })], [/media_publish/, () => ({ id: 'ig_media_1' })],
      ...waRoutes({}),
    ]);
    const cfg = { ...testConfig, DRY_RUN: false };
    const r = await attemptSend(today, new Date(`${today}T07:00:00+05:30`), 'send_now', { cfg, storage: createStorage(cfg), fetchFn: m.fn, sleep: noSleep });
    expect(r).toMatchObject({ action: 'partial', channels: { ig_feed: 'success', ig_story: 'failed', wa_customers: 'success' } });
    const feed = await Delivery.findOne({ date: today, channel: 'ig_feed', recipientHash: { $exists: false } });
    expect(feed).toMatchObject({ status: 'success', externalId: 'ig_media_1', dryRun: false });
    const story = await Delivery.findOne({ date: today, channel: 'ig_story', recipientHash: { $exists: false } });
    expect(story).toMatchObject({ status: 'failed', attempts: 1, retryable: false }); // limit reached → no retries
    const wa = await Delivery.findOne({ date: today, channel: 'wa_customers', recipientHash: { $exists: false } });
    expect(wa!.stats).toMatchObject({ total: 3, sent: 3, failed: 0 });
    expect((await Rate.findOne({ date: today }))!.status).toBe('approved');
    await Integration.deleteMany({});
  });
  it('live mode without a connection fails clearly instead of pretending', async () => {
    await Rate.deleteMany({}); await SendDay.deleteMany({}); await Integration.deleteMany({});
    const today = istDate();
    await Rate.create({ date: today, ...rate, status: 'approved', enteredBy: 'a' });
    const cfg = { ...testConfig, DRY_RUN: false };
    const r = await attemptSend(today, new Date(`${today}T07:00:00+05:30`), 'send_now', { cfg, storage: createStorage(cfg), fetchFn: mockFetch([]).fn, sleep: noSleep });
    expect(r.action).toBe('partial');
    const d = await Delivery.findOne({ date: today, channel: 'ig_feed' });
    expect(d!.error).toMatch(/not connected/);
    expect(d!.attempts).toBe(1);
  });
});

// ---------------------------------------------------------------- webhooks
const sign = (body: string) => `sha256=${crypto.createHmac('sha256', TEST_APP_SECRET).update(body).digest('hex')}`;
const waEvent = (value: any) => ({ object: 'whatsapp_business_account', entry: [{ id: '555', changes: [{ value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PHONE1' }, ...value }, field: 'messages' }] }] });

describe('webhooks', () => {
  it('GET verification returns the challenge only with the right token', async () => {
    const ok = await request(app).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
    expect(ok.status).toBe(200); expect(ok.text).toBe('12345');
    expect((await request(app).get('/api/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status).toBe(403);
  });
  it('rejects a bad or missing signature and accepts a valid one (no cookie / CSRF needed)', async () => {
    const body = JSON.stringify(waEvent({ statuses: [] }));
    expect((await request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').send(body)).status).toBe(401);
    expect((await request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=deadbeef').send(body)).status).toBe(401);
    const good = await request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sign(body)).send(body);
    expect(good.status).toBe(200);
    expect(verifySignature(Buffer.from(body), sign(body), TEST_APP_SECRET)).toBe(true);
    expect(verifySignature(Buffer.from(body), sign(body).slice(0, -1) + '0', TEST_APP_SECRET)).toBe(false);
  });
  it('status updates move a delivery through sent → delivered → read, and failed stores the Meta error', async () => {
    await Delivery.create({ date: '2026-09-18', channel: 'wa_customers', trigger: 'cron', status: 'success', externalId: 'wamid.A', recipientHash: 'h', idempotencyKey: '2026-09-18:wa_cloud:h' });
    await Delivery.create({ date: '2026-09-18', channel: 'wa_customers', trigger: 'cron', status: 'success', externalId: 'wamid.B', recipientHash: 'h2', idempotencyKey: '2026-09-18:wa_cloud:h2' });
    const s1 = await processWhatsAppEvent(waEvent({ statuses: [{ id: 'wamid.A', status: 'sent', timestamp: '1789000000', recipient_id: '919876500001' }, { id: 'wamid.A', status: 'delivered', timestamp: '1789000010', recipient_id: '919876500001' }] }), testConfig);
    expect(s1).toMatchObject({ statuses: 2, duplicates: 0 });
    expect((await Delivery.findOne({ externalId: 'wamid.A' }))!.waStatus).toBe('delivered');
    // out-of-order + duplicate
    const s2 = await processWhatsAppEvent(waEvent({ statuses: [{ id: 'wamid.A', status: 'read', timestamp: '1789000020' }, { id: 'wamid.A', status: 'sent', timestamp: '1789000000' }] }), testConfig);
    expect(s2).toMatchObject({ statuses: 1, duplicates: 1 });
    expect((await Delivery.findOne({ externalId: 'wamid.A' }))!.waStatus).toBe('read');
    await processWhatsAppEvent(waEvent({ statuses: [{ id: 'wamid.B', status: 'failed', timestamp: '1789000030', errors: [{ code: 131047, title: 'Re-engagement message', message: 'Re-engagement message', error_data: { details: 'More than 24 hours' } }] }] }), testConfig);
    expect(await Delivery.findOne({ externalId: 'wamid.B' })).toMatchObject({ status: 'failed', waStatus: 'failed', metaErrorCode: 131047, metaErrorMessage: 'More than 24 hours' });
  });
  it('JOIN opts in, STOP opts out, duplicates are ignored, RATE is only logged (Phase 5)', async () => {
    const msg = (id: string, text: string) => waEvent({ contacts: [{ wa_id: '919876511111', profile: { name: 'Test' } }], messages: [{ from: '919876511111', id, timestamp: '1789000000', type: 'text', text: { body: text } }] });
    const a = await processWhatsAppEvent(msg('wamid.m1', 'JOIN'), testConfig);
    expect(a).toMatchObject({ messages: 1, joins: 1 });
    const sub = await Subscriber.findOne({ phoneHash: lookupHash('+919876511111') }).select('+phoneEnc');
    expect(sub).toMatchObject({ status: 'active', optInSource: 'whatsapp_join', phoneMasked: '+91••••••1111' });
    expect(decrypt(sub!.phoneEnc)).toBe('+919876511111');
    expect(sub!.phoneEnc).not.toContain('9876511111');
    expect((await processWhatsAppEvent(msg('wamid.m1', 'JOIN'), testConfig)).duplicates).toBe(1);
    const b = await processWhatsAppEvent(msg('wamid.m2', 'stop'), testConfig);
    expect(b.stops).toBe(1);
    expect((await Subscriber.findOne({ phoneHash: lookupHash('+919876511111') }))!.status).toBe('opted_out');
    expect((await processWhatsAppEvent(msg('wamid.m3', 'RATE'), testConfig)).rateKeyword).toBe(1);
    expect(await WebhookEvent.countDocuments({ source: 'whatsapp' })).toBe(3);
  });
});

// ---------------------------------------------------------------- integrations + subscribers API
describe('integrations API', () => {
  it('stores the token encrypted and never returns it; test connection updates status', async () => {
    await Integration.deleteMany({}); await AuditLog.deleteMany({ entity: 'integration' });
    const token = 'EAAB_SUPER_SECRET_TOKEN_1234567890';
    expect((await staff.put('/api/v1/integrations/instagram', { accessToken: token, accountId: '1789' })).status).toBe(403);
    const put = await admin.put('/api/v1/integrations/instagram', { accessToken: token, accountId: '1789' });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain(token);
    expect(put.body.item).toMatchObject({ channel: 'instagram', hasToken: true, tokenTail: '…7890', status: 'not_configured' });
    const list = await admin.get('/api/v1/integrations');
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.dryRun).toBe(true);
    const raw = await Integration.findOne({ channel: 'instagram' }).select('+encryptedToken').lean();
    expect(raw!.encryptedToken).not.toContain(token);
    expect(decrypt(raw!.encryptedToken!)).toBe(token);
    expect(JSON.stringify(await AuditLog.find({ entity: 'integration' }).lean())).not.toContain(token);
    // test connection (mocked): username comes back, status → connected
    const ok = mockFetch([[/GET .*\/1789$/, () => ({ id: '1789', username: 'chhedajewellers' })]]);
    expect(await testConnection('instagram', testConfig, ok.fn)).toMatchObject({ ok: true, displayName: '@chhedajewellers' });
    expect(ok.calls[0].auth).toBe(`Bearer ${token}`);
    expect((await Integration.findOne({ channel: 'instagram' }))!.status).toBe('connected');
    const bad = mockFetch([[/GET .*\/1789$/, () => ({ status: 400, body: { error: { message: 'Invalid OAuth access token', code: 190 } } })]]);
    expect(await testConnection('instagram', testConfig, bad.fn)).toMatchObject({ ok: false, error: /Invalid OAuth/ });
    expect((await Integration.findOne({ channel: 'instagram' }))).toMatchObject({ status: 'error', lastError: expect.stringMatching(/Invalid OAuth/) });
    expect((await admin.post('/api/v1/integrations/instagram/test')).status).toBe(200);
  });
  it('daily health check alerts 7 days before expiry and immediately on an invalid token', async () => {
    await Integration.deleteMany({}); await Alert.deleteMany({});
    await saveIntegration('whatsapp', { accessToken: 'WA_TOKEN_1234567890123', accountId: '555', phoneNumberId: 'PHONE1', expiresAt: new Date(Date.now() + 3 * 86_400_000) }, 'admin');
    const ok = mockFetch([[/GET .*\/PHONE1$/, () => ({ display_phone_number: '+91 98765 00000', verified_name: 'Chheda' })]]);
    const problems = await checkIntegrationsHealth({ ...testConfig, DRY_RUN: false }, '2026-09-18', ok.fn);
    expect(problems.join()).toMatch(/whatsapp token expires in 2 day/);
    expect(await Alert.countDocuments({ type: 'token_expiring' })).toBe(1);
    const bad = mockFetch([[/GET .*\/PHONE1$/, () => ({ status: 400, body: { error: { message: 'Session has expired', code: 190 } } })]]);
    const p2 = await checkIntegrationsHealth({ ...testConfig, DRY_RUN: false }, '2026-09-19', bad.fn);
    expect(p2.join()).toMatch(/token invalid/);
    expect(await Alert.countDocuments({ dedupeKey: 'token_invalid:whatsapp:2026-09-19' })).toBe(1);
    await Integration.deleteMany({});
  });
});

describe('subscribers API', () => {
  it('add / list masked / import CSV with validation / remove; roles enforced', async () => {
    expect((await request(app).get('/api/v1/subscribers')).status).toBe(401);
    expect((await staff.post('/api/v1/subscribers', { phone: '+919876500001', optInSource: 'in_store' })).status).toBe(403);
    const add = await admin.post('/api/v1/subscribers', { phone: '98765 00001', optInSource: 'in_store', name: 'Priya' });
    expect(add.status).toBe(201);
    expect(add.body.item.phoneMasked).toBe('+91••••••0001');
    expect(JSON.stringify(add.body)).not.toContain('9876500001');
    expect((await admin.post('/api/v1/subscribers', { phone: '12', optInSource: 'in_store' })).status).toBe(422);
    expect((await admin.post('/api/v1/subscribers', { phone: '+919876500002', optInSource: 'bogus' })).status).toBe(422);
    const csv = 'phone,optInSource,name\n+919876500002,website,Rahul\n9876500003,In Store,\nnot-a-number,website,\n+919876500004,unknown-source,\n+919876500001,manual,Dup\n';
    const imp = await admin.post('/api/v1/subscribers/import', { csv });
    expect(imp.status).toBe(200);
    expect(imp.body).toMatchObject({ added: 2, alreadyActive: 1, reactivated: 0 });
    expect(imp.body.errors).toEqual([{ row: 4, problem: expect.stringMatching(/invalid phone/) }, { row: 5, problem: expect.stringMatching(/optInSource/) }]);
    expect((await admin.post('/api/v1/subscribers/import', { csv: 'nope' })).status).toBe(422);
    const list = await staff.get('/api/v1/subscribers');
    expect(list.body.counts).toMatchObject({ active: 3, total: 3 });
    expect(list.body.items.every((i: any) => /^\+91•{6}\d{4}$/.test(i.phoneMasked))).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/98765000\d\d/);
    expect((await admin.delete(`/api/v1/subscribers/${list.body.items[0].id}`)).status).toBe(200);
    expect((await admin.get('/api/v1/subscribers')).body.counts.total).toBe(2);
  });
  it('settings accept the WhatsApp template name/language and reject bad names', async () => {
    const ok = await admin.put('/api/v1/settings', { whatsapp: { templateName: 'daily_gold_rate_v2', templateLanguage: 'en_US', includeExtrasParam: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.whatsapp).toEqual({ templateName: 'daily_gold_rate_v2', templateLanguage: 'en_US', includeExtrasParam: true });
    expect((await admin.put('/api/v1/settings', { whatsapp: { templateName: 'Bad Name!' } })).status).toBe(422);
  });
});
