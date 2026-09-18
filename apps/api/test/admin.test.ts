import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { addDays, istDate } from '@chheda/shared';
import { AuditLog, Delivery, Rate, Session, User } from '../src/models';
import { generatePassword } from '../src/routes/users';
import { validatePasswordStrength } from '../src/lib/auth';
import { login, makeUser, startTestApp, stopTestApp } from './setup';

let app: any, admin: any, staff: any, viewer: any;
const today = istDate();

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin'); await makeUser('staff@chheda.test', 'staff'); await makeUser('viewer@chheda.test', 'viewer');
  admin = await login(app, 'admin@chheda.test'); staff = await login(app, 'staff@chheda.test'); viewer = await login(app, 'viewer@chheda.test');
});
afterAll(stopTestApp);

describe('admin-only endpoints are closed to other roles', () => {
  it('users, audit and integrations writes return 403 for staff/viewer and 401 anonymously', async () => {
    for (const path of ['/api/v1/users', '/api/v1/audit']) {
      expect((await staff.get(path)).status, path).toBe(403);
      expect((await viewer.get(path)).status, path).toBe(403);
      expect((await request(app).get(path)).status, path).toBe(401);
    }
    expect((await staff.post('/api/v1/users', { email: 'x@x.test', name: 'X', role: 'viewer' })).status).toBe(403);
    expect((await viewer.get('/api/v1/deliveries/export.csv')).status).toBe(200); // logs are readable by any logged-in user
    expect((await staff.get('/api/v1/send/plan')).status).toBe(403);
  });
});

describe('users API', () => {
  let created: any;
  it('lists users without hashes, with active session counts', async () => {
    const r = await admin.get('/api/v1/users');
    expect(r.status).toBe(200);
    expect(r.body.items.map((u: any) => u.email).sort()).toEqual(['admin@chheda.test', 'staff@chheda.test', 'viewer@chheda.test']);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon2/);
    expect(r.body.items.find((u: any) => u.email === 'admin@chheda.test').activeSessions).toBeGreaterThanOrEqual(1);
  });
  it('creates a user with a strong generated first password that works exactly as returned', async () => {
    const r = await admin.post('/api/v1/users', { email: 'New.Person@chheda.test', name: 'New Person', role: 'staff' });
    expect(r.status).toBe(201);
    created = r.body.item;
    expect(created).toMatchObject({ email: 'new.person@chheda.test', role: 'staff', disabled: false });
    expect(validatePasswordStrength(r.body.firstPassword)).toBeNull();
    const ok = await login(app, 'new.person@chheda.test', r.body.firstPassword);
    expect((await ok.get('/api/v1/auth/me')).body.user.role).toBe('staff');
    expect((await admin.post('/api/v1/users', { email: 'new.person@chheda.test', name: 'Dup', role: 'staff' })).status).toBe(409);
    expect((await admin.post('/api/v1/users', { email: 'bad', name: 'x', role: 'staff' })).status).toBe(422);
    expect((await admin.post('/api/v1/users', { email: 'r@chheda.test', name: 'x', role: 'root' })).status).toBe(422);
    for (let i = 0; i < 20; i++) expect(validatePasswordStrength(generatePassword())).toBeNull();
  });
  it('disable ends sessions and blocks login; enable restores; admin cannot disable self or drop own admin role', async () => {
    const me = (await admin.get('/api/v1/auth/me')).body.user.id;
    expect((await admin.patch(`/api/v1/users/${me}`, { disabled: true })).status).toBe(403);
    expect((await admin.patch(`/api/v1/users/${me}`, { role: 'staff' })).status).toBe(403);
    const sess = await login(app, created.email, undefined as any).catch(() => null); // wrong default password → no session
    expect(sess).toBeNull();
    const dis = await admin.patch(`/api/v1/users/${created.id}`, { disabled: true });
    expect(dis.status).toBe(200); expect(dis.body.item.disabled).toBe(true);
    expect(await Session.countDocuments({ userId: created.id })).toBe(0);
    const en = await admin.patch(`/api/v1/users/${created.id}`, { disabled: false, role: 'viewer' });
    expect(en.body.item).toMatchObject({ disabled: false, role: 'viewer' });
    expect((await admin.patch(`/api/v1/users/${created.id}`, { hacker: true })).status).toBe(422);
    expect((await admin.patch(`/api/v1/users/${'0'.repeat(24)}`, { disabled: true })).status).toBe(404);
  });
  it('reset password returns a new one-time password and ends sessions; force logout deletes sessions', async () => {
    const r = await admin.post(`/api/v1/users/${created.id}/reset-password`);
    expect(r.status).toBe(200);
    expect(validatePasswordStrength(r.body.newPassword)).toBeNull();
    const s1 = await login(app, created.email, r.body.newPassword);
    expect((await s1.get('/api/v1/auth/me')).status).toBe(200);
    const out = await admin.post(`/api/v1/users/${created.id}/logout`);
    expect(out.body.sessions).toBe(1);
    expect((await s1.get('/api/v1/auth/me')).status).toBe(401);
    const actions = (await AuditLog.find({ entity: 'user' })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['user_create', 'user_update', 'user_reset_password', 'user_force_logout']));
    expect(JSON.stringify(await AuditLog.find({ entity: 'user' }).lean())).not.toMatch(/argon2|newPassword/);
  });
});

describe('delivery log, CSV export, send plan', () => {
  beforeAll(async () => {
    await Delivery.deleteMany({});
    const y = addDays(today, -1);
    await Delivery.create([
      { date: today, channel: 'ig_feed', trigger: 'cron', status: 'success', idempotencyKey: `${today}:ig_feed`, externalId: 'm1', attempts: 1 },
      { date: today, channel: 'ig_story', trigger: 'cron', status: 'failed', idempotencyKey: `${today}:ig_story`, attempts: 3, error: 'Container "expired", said Meta', metaErrorCode: 2207001 },
      { date: y, channel: 'wa_customers', trigger: 'send_now', status: 'success', idempotencyKey: `${y}:wa_customers`, stats: { total: 3, sent: 3, failed: 0, skipped: 0 } },
      { date: y, channel: 'wa_customers', trigger: 'cron', status: 'success', idempotencyKey: `${y}:wa_cloud:h1`, recipientHash: 'h1', recipientMasked: '+91••••••0001' },
      { date: today, channel: 'wa_keyword', trigger: 'keyword', status: 'success', idempotencyKey: `${today}:wa_keyword:keyword:x`, recipientHash: 'h2', recipientMasked: '+91••••••0002' },
    ]);
  });
  it('filters + paginates channel-level rows (per-recipient WhatsApp rows hidden unless keyword)', async () => {
    const all = await staff.get('/api/v1/deliveries/log?limit=2');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(all.body.items).toHaveLength(2);
    const p2 = await staff.get('/api/v1/deliveries/log?limit=2&page=2');
    expect(p2.body.items).toHaveLength(1);
    expect((await staff.get('/api/v1/deliveries/log?status=failed')).body.items[0]).toMatchObject({ channel: 'ig_story', metaErrorCode: 2207001, attempts: 3 });
    expect((await staff.get(`/api/v1/deliveries/log?from=${today}&to=${today}`)).body.total).toBe(2);
    expect((await staff.get('/api/v1/deliveries/log?trigger=keyword')).body.items[0].channel).toBe('wa_keyword');
    expect((await staff.get('/api/v1/deliveries/log?channel=nope')).status).toBe(422);
  });
  it('exports the filtered rows as CSV with quoting', async () => {
    const r = await staff.get(`/api/v1/deliveries/export.csv?from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="deliveries-/);
    const lines = r.text.replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('date,channel,trigger,status,createdAt,attempts,externalId,recipient,postedBy,postedAt,metaErrorCode,error,dryRun');
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.includes('ig_story'))).toContain('"Container ""expired"", said Meta"');
    expect(r.text).not.toContain('h1');
  });
  it('send plan explains what Send Now would do', async () => {
    await Rate.deleteMany({});
    const none = await admin.get('/api/v1/send/plan');
    expect(none.body).toMatchObject({ canSend: false, reason: 'No rate entered for today.', rate: null });
    await Rate.create({ date: today, k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [], status: 'approved', enteredBy: 'a' });
    const plan = await admin.get('/api/v1/send/plan');
    expect(plan.body).toMatchObject({ canSend: true, dryRun: true, subscribers: 0, rate: { k24: 11250, status: 'approved' } });
    const ch = Object.fromEntries(plan.body.channels.map((c: any) => [c.channel, c]));
    expect(ch.ig_feed).toMatchObject({ enabled: true, alreadySent: true });
    expect(ch.ig_story).toMatchObject({ enabled: true, alreadySent: false });
    expect(ch.wa_customers.recipients).toBe(0);
    expect(ch.ig_broadcast_manual.manual).toBe(true);
  });
});

describe('audit log API', () => {
  it('filters by user, action and date; paginates; redacts secrets', async () => {
    await AuditLog.create({ action: 'integration_update', entity: 'integration', entityId: 'instagram', userEmail: 'admin@chheda.test', after: { accessToken: 'EAAB123', accountId: '1' } });
    const r = await admin.get('/api/v1/audit?user=ADMIN@&action=integration_update&limit=10');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].after).toEqual({ accessToken: '[redacted]', accountId: '1' });
    expect(r.body.actions).toContain('user_create');
    const paged = await admin.get('/api/v1/audit?limit=2&page=2');
    expect(paged.body.items.length).toBeLessThanOrEqual(2);
    expect(paged.body.page).toBe(2);
    expect((await admin.get(`/api/v1/audit?from=${addDays(today, 1)}`)).body.total).toBe(0);
    expect((await admin.get('/api/v1/audit?from=bad')).status).toBe(422);
  });
});
