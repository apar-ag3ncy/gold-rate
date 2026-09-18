import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { addDays, istDate } from '@chheda/shared';
import { AuditLog, Rate } from '../src/models';
import { login, makeUser, startTestApp, stopTestApp } from './setup';

let app: any;
const today = istDate();
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);
const R = '/api/v1/rates';
const good = { k24: '11250', k22: '10305.50', k18: '8437' };

beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin');
  await makeUser('staff@chheda.test', 'staff');
});
afterAll(stopTestApp);

describe('auth & security', () => {
  it('health check works', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
  });
  it('blocks unauthenticated access', async () => {
    expect((await request(app).get(R)).status).toBe(401);
  });
  it('rejects wrong password with a generic message', async () => {
    const r = await request(app).post('/api/v1/auth/login').set('x-requested-with', 'chheda-web').send({ email: 'admin@chheda.test', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Incorrect email or password');
  });
  it('rejects state-changing requests without CSRF header', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'admin@chheda.test', password: 'Str0ngPassw0rd' });
    expect(r.status).toBe(403);
  });
  it('rejects requests from a foreign origin', async () => {
    const r = await request(app).post('/api/v1/auth/login').set('x-requested-with', 'chheda-web').set('origin', 'https://evil.example').send({});
    expect(r.status).toBe(403);
  });
  it('sets an httpOnly SameSite=Strict cookie and never returns the hash', async () => {
    const r = await request(app).post('/api/v1/auth/login').set('x-requested-with', 'chheda-web').send({ email: 'admin@chheda.test', password: 'Str0ngPassw0rd' });
    expect(r.status).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon/);
  });
  it('locks the account after 5 failed attempts', async () => {
    await makeUser('lock@chheda.test', 'viewer');
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').set('x-requested-with', 'chheda-web').send({ email: 'lock@chheda.test', password: 'bad' });
    const r = await request(app).post('/api/v1/auth/login').set('x-requested-with', 'chheda-web').send({ email: 'lock@chheda.test', password: 'Str0ngPassw0rd' });
    expect(r.status).toBe(429);
  });
  it('staff cannot enter rates', async () => {
    const staff = await login(app, 'staff@chheda.test');
    expect((await staff.put(`${R}/${tomorrow}`, good)).status).toBe(403);
    expect((await staff.get(R)).status).toBe(200);
  });
  it('logout ends the session', async () => {
    const a = await login(app, 'admin@chheda.test');
    await a.post('/api/v1/auth/logout');
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('rate entry', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  beforeAll(async () => { admin = await login(app, 'admin@chheda.test'); });

  it('saves exactly what was typed as a draft', async () => {
    const r = await admin.put(`${R}/${today}`, { ...good, extraPurities: [{ label: '14K', value: '6560' }] });
    expect(r.status).toBe(200);
    expect(r.body.rate).toMatchObject({ date: today, k24: 11250, k22: 10305.5, k18: 8437, status: 'draft', unit: 'per_gram', enteredBy: 'admin@chheda.test' });
    expect(r.body.rate.extraPurities).toEqual([{ label: '14K', value: 6560 }]);
  });
  it('rejects missing purities with field errors', async () => {
    const r = await admin.put(`${R}/${tomorrow}`, { k24: '11250' });
    expect(r.status).toBe(422);
    expect(r.body.details.fields).toHaveProperty('k22');
    expect(await Rate.countDocuments({ date: tomorrow })).toBe(0);
  });
  it('rejects an extra-digit typo and saves nothing', async () => {
    const r = await admin.put(`${R}/${tomorrow}`, { ...good, k24: '112500' });
    expect(r.status).toBe(422);
    expect(r.body.details.errors.join()).toMatch(/outside the allowed range/);
  });
  it('rejects past dates and invalid dates', async () => {
    expect((await admin.put(`${R}/${yesterday}`, good)).status).toBe(422);
    expect((await admin.put(`${R}/2026-02-30`, good)).status).toBe(422);
  });
  it('approves (same admin allowed)', async () => {
    const r = await admin.post(`${R}/${today}/approve`);
    expect(r.status).toBe(200);
    expect(r.body.rate).toMatchObject({ status: 'approved', approvedBy: 'admin@chheda.test' });
    expect((await admin.post(`${R}/${today}/approve`)).status).toBe(409);
  });
  it('big change vs last approved rate needs an override reason', async () => {
    const bad = await admin.put(`${R}/${tomorrow}`, { k24: '12500', k22: '11450', k18: '9375' });
    expect(bad.status).toBe(422);
    expect(bad.body.details.errors.join()).toMatch(/override reason/);
    const ok = await admin.put(`${R}/${tomorrow}`, { k24: '12500', k22: '11450', k18: '9375', overrideReason: 'Import duty change' });
    expect(ok.status).toBe(200);
    expect(ok.body.warnings).toHaveLength(1);
  });
  it('editing an approved rate sends it back to draft (must re-approve)', async () => {
    const r = await admin.put(`${R}/${today}`, { ...good, k24: '11260' });
    expect(r.body.rate.status).toBe('draft');
    expect(r.body.rate.approvedBy).toBeUndefined();
    expect(r.body.rate.revisions.at(-1).action).toBe('update_unapproved');
  });
  it('sent rates are locked', async () => {
    await Rate.updateOne({ date: today }, { status: 'sent' });
    const r = await admin.put(`${R}/${today}`, good);
    expect(r.status).toBe(409);
    expect((await admin.post(`${R}/${today}/cancel`, { reason: 'test' })).status).toBe(409);
  });
  it('cancel requires a reason', async () => {
    expect((await admin.post(`${R}/${tomorrow}/cancel`, {})).status).toBe(422);
    const r = await admin.post(`${R}/${tomorrow}/cancel`, { reason: 'Wrong day' });
    expect(r.body.rate.status).toBe('cancelled');
  });
  it('lists history newest first and returns summary', async () => {
    const r = await admin.get(`${R}?limit=10`);
    expect(r.body.items.map((x: any) => x.date)).toEqual([tomorrow, today]);
    const s = await admin.get(`${R}/summary`);
    expect(s.body).toMatchObject({ today, tomorrow });
    expect(s.body.todayRate.k24).toBe(11260);
  });
  it('writes an audit trail', async () => {
    const actions = (await AuditLog.find({ entity: 'rate' })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['rate_create', 'rate_update', 'rate_approve', 'rate_cancel']));
  });
});

describe('settings', () => {
  it('admin can set custom send + cutoff time; invalid combos rejected', async () => {
    const admin = await login(app, 'admin@chheda.test');
    const ok = await admin.put('/api/v1/settings', { sendTime: '07:00', cutoffTime: '10:15', automationOn: true, channels: { rateKeywordReply: false } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ sendTime: '07:00', cutoffTime: '10:15', automationOn: true });
    expect(ok.body.settings.channels).toMatchObject({ rateKeywordReply: false, igFeed: true });
    expect((await admin.put('/api/v1/settings', { cutoffTime: '06:00' })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { sendTime: '7am' })).status).toBe(422);
    expect((await admin.put('/api/v1/settings', { hacker: true })).status).toBe(422);
  });
  it('staff cannot change settings', async () => {
    const staff = await login(app, 'staff@chheda.test');
    expect((await staff.put('/api/v1/settings', { automationOn: false })).status).toBe(403);
  });
});

describe('BUG 1 regression – decimals with trailing zeros', () => {
  it('8512.50 / 8512.5 save as the same exact value and can be approved; 8512.500 is blocked by the 2-decimal rule', async () => {
    const admin = await login(app, 'admin@chheda.test');
    const d = addDays(today, 3);
    for (const t of ['8512.50', '8512.5']) {
      const r = await admin.put(`${R}/${d}`, { k24: '11250', k22: '10305.50', k18: t, extraPurities: [{ label: '14K', value: '6560.50' }] });
      expect(r.status, t).toBe(200);
      expect(r.body.rate.k18).toBe(8512.5);
      expect(r.body.rate.k22).toBe(10305.5);
      expect(r.body.rate.extraPurities[0].value).toBe(6560.5);
      expect((await Rate.findOne({ date: d }))!.k18).toBe(8512.5);
    }
    expect((await admin.put(`${R}/${d}`, { k24: '11250', k22: '10305.5', k18: '8512.500' })).status).toBe(422);
    const ok = await admin.post(`${R}/${d}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.rate.status).toBe('approved');
    await admin.post(`${R}/${d}/cancel`, { reason: 'cleanup' });
  });
});
