import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { addDays, istDate, DEFAULT_CAPTION_TEMPLATE } from '@chheda/shared';
import { AuditLog, Delivery, Rate } from '../src/models';
import { login, makeUser, startTestApp, stopTestApp, TEST_MEDIA_DIR } from './setup';

let app: any;
let admin: Awaited<ReturnType<typeof login>>;
let staff: Awaited<ReturnType<typeof login>>;
const today = istDate();
const tomorrow = addDays(today, 1);
const good = { k24: '11250', k22: '10305.50', k18: '8437', extraPurities: [{ label: '14K', value: '6560' }] };

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin');
  await makeUser('staff@chheda.test', 'staff');
  admin = await login(app, 'admin@chheda.test');
  staff = await login(app, 'staff@chheda.test');
});
afterAll(stopTestApp);

describe('preview endpoints', () => {
  it('require login and the admin role', async () => {
    expect((await request(app).post(`/api/v1/preview/${today}`).set('x-requested-with', 'chheda-web')).status).toBe(401);
    expect((await staff.post(`/api/v1/preview/${today}`)).status).toBe(403);
    expect((await staff.post('/api/v1/preview', { date: today, ...good })).status).toBe(403);
  });
  it('404 for a date with no saved rate', async () => {
    const r = await admin.post(`/api/v1/preview/${today}`);
    expect(r.status).toBe(404);
  });
  it('renders images + caption for a saved draft and remembers the URLs on the rate', async () => {
    await admin.put(`/api/v1/rates/${today}`, good);
    const r = await admin.post(`/api/v1/preview/${today}`);
    expect(r.status).toBe(200);
    expect(r.body.saved).toBe(true);
    expect(r.body.feedUrl).toMatch(new RegExp(`/media/creative/${today}/feed-${today}-[0-9a-f]{16}\\.jpg$`));
    expect(r.body.storyUrl).toMatch(/story-.*\.jpg$/);
    expect(r.body.caption).toContain('22K: ₹10,305.5 /g');
    expect(r.body.caption).toContain('14K: ₹6,560 /g');
    // files exist on disk and are served publicly
    const rel = new URL(r.body.feedUrl).pathname.replace('/media/', '');
    expect(fs.existsSync(path.join(TEST_MEDIA_DIR, rel))).toBe(true);
    const img = await request(app).get(`/media/${rel}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const saved = await Rate.findOne({ date: today });
    expect(saved?.creativeUrls?.feed).toBe(r.body.feedUrl);
    expect(saved?.caption).toBe(r.body.caption);
    // same content → same file name, never re-written
    const again = await admin.post(`/api/v1/preview/${today}`);
    expect(again.body.feedUrl).toBe(r.body.feedUrl);
  });
  it('blocks path traversal on /media', async () => {
    expect((await request(app).get('/media/../package.json')).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).get('/media/nope.jpg')).status).toBe(404);
  });
  it('renders from unsaved values without saving anything', async () => {
    const before = await Rate.countDocuments();
    const r = await admin.post('/api/v1/preview', { date: tomorrow, k24: '11300', k22: '10350', k18: '8480' });
    expect(r.status).toBe(200);
    expect(r.body.saved).toBe(false);
    expect(r.body.feedUrl).toMatch(new RegExp(`/media/preview/${tomorrow}/feed-`));
    expect(r.body.caption).toContain('24K: ₹11,300 /g');
    expect(r.body.caption).not.toContain('14K');
    expect(await Rate.countDocuments()).toBe(before);
    expect(await Rate.findOne({ date: tomorrow })).toBeNull();
  });
  it('runs the same validation as saving (field errors + business rules)', async () => {
    const fields = await admin.post('/api/v1/preview', { date: tomorrow, k24: '11300' });
    expect(fields.status).toBe(422);
    expect(fields.body.details.fields).toHaveProperty('k22');
    const rules = await admin.post('/api/v1/preview', { date: tomorrow, k24: '113000', k22: '10350', k18: '8480' });
    expect(rules.status).toBe(422);
    expect(rules.body.details.errors.join()).toMatch(/outside the allowed range/);
    const past = await admin.post('/api/v1/preview', { date: addDays(today, -1), k24: '11300', k22: '10350', k18: '8480' });
    expect(past.status).toBe(422);
    expect((await admin.post('/api/v1/preview', { date: 'nope', k24: '11300', k22: '10350', k18: '8480' })).status).toBe(422);
  });
  it('uses the caption template from settings', async () => {
    const upd = await admin.put('/api/v1/settings', { captionTemplate: 'Gold {date}\n24K {k24} | 22K {k22} | 18K {k18}\n{extras}' });
    expect(upd.status).toBe(200);
    const r = await admin.post(`/api/v1/preview/${today}`);
    expect(r.body.caption).toBe(`Gold ${r.body.caption.split('\n')[0].slice(5)}\n24K ₹11,250 | 22K ₹10,305.5 | 18K ₹8,437\n14K: ₹6,560 /g`);
    const bad = await admin.put('/api/v1/settings', { captionTemplate: '{k24} {k22} {k18} {price}' });
    expect(bad.status).toBe(422);
    expect(bad.body.details.fields.captionTemplate).toMatch(/Unknown placeholder/);
    expect((await admin.put('/api/v1/settings', { captionTemplate: DEFAULT_CAPTION_TEMPLATE })).status).toBe(200);
    const s = await admin.get('/api/v1/settings');
    expect(s.body.settings.captionTemplate).toBe(DEFAULT_CAPTION_TEMPLATE);
  });
});

describe('test send', () => {
  it('is admin only', async () => {
    expect((await staff.post('/api/v1/send/test', { date: today })).status).toBe(403);
    expect((await request(app).post('/api/v1/send/test').set('x-requested-with', 'chheda-web')).status).toBe(401);
  });
  it('404 when nothing is saved for the date', async () => {
    expect((await admin.post('/api/v1/send/test', { date: addDays(today, 5) })).status).toBe(404);
  });
  it('records a DRY_RUN delivery to the admin only – never to customers', async () => {
    const r = await admin.post('/api/v1/send/test', { date: today });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.delivery).toMatchObject({ date: today, channel: 'wa_admin', trigger: 'test', status: 'test', recipient: 'admin@chheda.test', dryRun: true, requestedBy: 'admin@chheda.test' });
    expect(r.body.delivery.idempotencyKey).toMatch(new RegExp(`^${today}:wa_admin:test:`));
    expect(r.body.rendered.feedUrl).toMatch(/\.jpg$/);
    expect(r.body.rendered.caption).toContain('₹11,250');
    const all = await Delivery.find({ date: today });
    expect(all).toHaveLength(1);
    expect(all.every((d) => !['ig_feed', 'ig_story', 'wa_customers', 'ig_broadcast_manual', 'wa_channel_manual'].includes(d.channel))).toBe(true);
    // rate status untouched (still draft) – a test never counts as a real send
    expect((await Rate.findOne({ date: today }))?.status).toBe('draft');
    expect(await AuditLog.countDocuments({ action: 'send_test' })).toBe(1);
  });
  it('defaults to today and allows repeated test sends (unique nonce keys)', async () => {
    const r = await admin.post('/api/v1/send/test', {});
    expect(r.status).toBe(200);
    expect(r.body.delivery.date).toBe(today);
    expect(await Delivery.countDocuments({ date: today, trigger: 'test' })).toBe(2);
  });
  it('a real send key cannot be duplicated (unique index ready for Phase 3/4)', async () => {
    const base = { date: today, channel: 'ig_feed', trigger: 'cron', status: 'queued', idempotencyKey: `${today}:ig_feed` };
    await Delivery.create(base);
    await expect(Delivery.create(base)).rejects.toMatchObject({ code: 11000 });
    await Delivery.deleteMany({ trigger: 'cron' });
  });
  it('lists today\'s deliveries for any logged-in user', async () => {
    const r = await staff.get(`/api/v1/deliveries?date=${today}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0]).toMatchObject({ trigger: 'test', status: 'test' });
    expect((await request(app).get('/api/v1/deliveries')).status).toBe(401);
  });
});
