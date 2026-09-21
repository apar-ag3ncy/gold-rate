import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { addDays, istDate } from '@chheda/shared';
import { Alert, IbjaFetch, IbjaRate, Rate, Settings, getSettings } from '../src/models';
import { setAlertNotifier } from '../src/services/alerts';
import { autoDraftFromIbja, fetchAndStoreIbja, IbjaApiSource, IbjaWebsiteSource, ibjaTick, parseIbjaHomepage, pickIbjaForDraft } from '../src/services/ibja';
import { tick } from '../src/services/scheduler';
import { createStorage } from '../src/services/storage';
import { login, makeUser, startTestApp, stopTestApp, testConfig, testFetch } from './setup';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'ibja-home-2026-09-21.html'), 'utf8');
const NOW = new Date('2026-09-21T12:40:00+05:30');   // fixture captured 21/09/2026 (AM published, PM empty)
const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`);
const okHtml = async () => new Response(fixture, { status: 200, headers: { 'content-type': 'text/html' } });
const apiRows = (rows: any[]) => async () => new Response(JSON.stringify(rows), { status: 200 });

let app: any, admin: any, staff: any;
beforeAll(async () => {
  app = await startTestApp();
  await makeUser('admin@chheda.test', 'admin'); await makeUser('staff@chheda.test', 'staff');
  admin = await login(app, 'admin@chheda.test'); staff = await login(app, 'staff@chheda.test');
  setAlertNotifier(null, async () => {});
});
afterAll(async () => { setAlertNotifier(null); await stopTestApp(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  await Promise.all([IbjaRate.deleteMany({}), IbjaFetch.deleteMany({}), Rate.deleteMany({}), Alert.deleteMany({})]);
  testFetch.fn = okHtml;
  const s = await getSettings();
  s.set({ ibja: { enabled: true, autoDraft: false, autoApprove: false, draftFor: 'tomorrow', preferSession: 'PM', fetchTimes: ['12:40', '18:40'], maxAgeDays: 4 }, priceMin: 1000, priceMax: 50000, maxDailyChangePct: 5, automationOn: true, sendTime: '07:00', cutoffTime: '11:00' });
  await s.save();
});
afterEach(() => vi.useRealTimers());

describe('IBJA homepage parser (fixture from 21/09/2026)', () => {
  it('reads today AM, leaves PM absent, reads history for both tabs and the per-gram cards', () => {
    const p = parseIbjaHomepage(fixture);
    expect(p.today.AM).toMatchObject({ '999': '153056', '995': '152443', '916': '140199', '750': '114792', '585': '89538', silver999: '234562', platinum999: '61221' });
    expect(p.today.PM).toBeUndefined();
    expect(p.history[0]).toMatchObject({ rateDate: '2026-09-18', per10g: expect.objectContaining({ '999': expect.any(String) }) });
    expect(p.history.some((h) => h.session === 'AM' && h.rateDate === '2026-09-18' && h.per10g['999'] === '153658')).toBe(true);
    expect(p.history.some((h) => h.session === 'PM')).toBe(true);
    expect(p.perGramCards).toMatchObject({ '999': '15306', '916': '14020', '750': '11479' });
  });
  it('fails loudly when the layout changes', () => {
    expect(() => parseIbjaHomepage('<html>nothing here</html>')).toThrow(/layout changed/);
  });
});

describe('sources', () => {
  it('website source → today AM as an exact per-gram trio + history (never the rounded cards)', async () => {
    const src = new IbjaWebsiteSource('https://ibjarates.com/', okHtml);
    const snaps = await src.fetchRecent(NOW);
    expect(snaps[0]).toMatchObject({ rateDate: '2026-09-21', session: 'AM', source: 'website', perGram: { k24: '15305.6', k22: '14019.9', k18: '11479.2' } });
    expect(snaps.some((s) => s.rateDate === '2026-09-18' && s.session === 'PM')).toBe(true);
    expect(JSON.stringify(snaps[0].perGram)).not.toContain('15306');
  });
  it('website source: HTTP errors are retryable, layout errors are not', async () => {
    await expect(new IbjaWebsiteSource('u', async () => new Response('x', { status: 503 })).fetchRecent(NOW)).rejects.toMatchObject({ retryable: true });
    await expect(new IbjaWebsiteSource('u', async () => new Response('<html/>', { status: 200 })).fetchRecent(NOW)).rejects.toMatchObject({ retryable: false });
  });
  it('official API source: builds the request, groups rows by date+session, maps errors', async () => {
    const calls: string[] = [];
    const rows = [
      { RateDate: '21/09/2026', RateTime: '12AM', Purity: '999', GoldRate: '153056', SilverRate: '234562' }, { RateDate: '21/09/2026', RateTime: '12AM', Purity: '916', GoldRate: '140199' },
      { RateDate: '21/09/2026', RateTime: '12AM', Purity: '750', GoldRate: '114792' }, { RateDate: '21/09/2026', RateTime: '12AM', Purity: '995', GoldRate: '152443' },
      { RateDate: '18/09/2026', RateTime: '6PM', Purity: '999', GoldRate: '153658' }, { RateDate: '18/09/2026', RateTime: '6PM', Purity: '916', GoldRate: '140751' }, { RateDate: '18/09/2026', RateTime: '6PM', Purity: '750', GoldRate: '115244' },
    ];
    const src = new IbjaApiSource({ IBJA_API_TOKEN: 'TOK', IBJA_API_BASE: 'https://ibjarates.com' }, async (u) => { calls.push(u); return new Response(JSON.stringify(rows), { status: 200 }); });
    const snaps = await src.fetchRecent(NOW);
    expect(calls[0]).toBe('https://ibjarates.com/API/GoldRates/?ACCESS_TOKEN=TOK&START_DATE=17/09/2026&END_DATE=21/09/2026');
    expect(snaps.map((s) => `${s.rateDate}:${s.session}`)).toEqual(['2026-09-21:AM', '2026-09-18:PM']);
    expect(snaps[0].perGram).toEqual({ k24: '15305.6', k22: '14019.9', k18: '11479.2' });
    expect(snaps[0].per10g.silver999).toBe('234562');
    await expect(new IbjaApiSource({ IBJA_API_TOKEN: 'TOK', IBJA_API_BASE: 'x' }, apiRows([{ status: 'Invalid', message: 'Invalid Access Token.' }])).fetchRecent(NOW)).rejects.toMatchObject({ retryable: false, message: /Invalid Access Token/ });
    await expect(new IbjaApiSource({ IBJA_API_TOKEN: 'TOK', IBJA_API_BASE: 'x' }, apiRows([{ status: 'success', message: 'You have reached the maximum API hit limit.' }])).fetchRecent(NOW)).rejects.toMatchObject({ retryable: true });
    expect(await new IbjaApiSource({ IBJA_API_TOKEN: 'TOK', IBJA_API_BASE: 'x' }, apiRows([{ status: 'success', message: 'No Record Found' }])).fetchRecent(NOW)).toEqual([]);
    await expect(new IbjaApiSource({ IBJA_API_TOKEN: undefined, IBJA_API_BASE: 'x' }).fetchRecent(NOW)).rejects.toMatchObject({ retryable: false });
  });
});

describe('fetch + store', () => {
  it('upserts snapshots once, keeps the first-published digits, records the attempt', async () => {
    const r1 = await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW, slot: '12:40' });
    expect(r1.ok).toBe(true); expect(r1.inserted).toBeGreaterThan(1);
    expect(r1.latest).toMatchObject({ rateDate: '2026-09-21', session: 'AM', perGram: { k24: '15305.6' } });
    const r2 = await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW, slot: 'manual' });
    expect(r2.ok && r2.inserted).toBe(0);
    expect(await IbjaRate.countDocuments({ rateDate: '2026-09-21' })).toBe(1);
    expect(await IbjaFetch.countDocuments({ ok: true })).toBe(2);
  });
  it('a failed fetch is recorded and raises one alert per day; nothing crashes', async () => {
    const r = await fetchAndStoreIbja(testConfig, { fetchFn: async () => new Response('', { status: 500 }), now: NOW });
    expect(r.ok).toBe(false);
    await fetchAndStoreIbja(testConfig, { fetchFn: async () => { throw new Error('ENOTFOUND'); }, now: NOW });
    expect(await IbjaFetch.countDocuments({ ok: false })).toBe(2);
    expect(await Alert.countDocuments({ type: 'ibja_fetch_failed' })).toBe(1);
  });
});

describe('auto-draft rules', () => {
  const seed = async () => fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW });
  it('is off by default; with autoDraft it drafts TOMORROW from the newest date (PM preferred, AM if PM missing) and alerts', async () => {
    await seed();
    expect((await autoDraftFromIbja(testConfig, { now: NOW })).action).toBe('disabled');
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    const r = await autoDraftFromIbja(testConfig, { now: NOW });
    expect(r).toMatchObject({ action: 'drafted', date: '2026-09-22', k24: '15305.6', k22: '14019.9', k18: '11479.2' });
    const rate = await Rate.findOne({ date: '2026-09-22' });
    expect(rate).toMatchObject({ status: 'draft', source: 'ibja', enteredBy: 'system:ibja', k24: 15305.6, k22: 14019.9, k18: 11479.2 });
    expect(rate!.ibja).toMatchObject({ rateDate: '2026-09-21', session: 'AM', source: 'website' });
    expect(await Alert.countDocuments({ type: 'ibja_draft_ready', date: '2026-09-22' })).toBe(1);
    expect((await autoDraftFromIbja(testConfig, { now: NOW })).action).toBe('unchanged');   // same snapshot → no churn, no second alert
    expect(await Alert.countDocuments({ type: 'ibja_draft_ready' })).toBe(1);
  });
  it('never overwrites a rate a person entered or approved', async () => {
    await seed(); await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    await Rate.create({ date: '2026-09-22', k24: 15400, k22: 14100, k18: 11500, extraPurities: [], status: 'draft', enteredBy: 'admin@chheda.test', source: 'admin' });
    expect((await autoDraftFromIbja(testConfig, { now: NOW })).action).toBe('kept_admin_rate');
    expect((await Rate.findOne({ date: '2026-09-22' }))!.k24).toBe(15400);
    await Rate.updateOne({ date: '2026-09-22' }, { source: 'ibja', status: 'approved', approvedBy: 'admin@chheda.test' });
    expect((await autoDraftFromIbja(testConfig, { now: NOW })).action).toBe('kept_admin_rate');
    await Rate.updateOne({ date: '2026-09-22' }, { status: 'sent' });
    expect((await autoDraftFromIbja(testConfig, { now: NOW })).action).toBe('sent_locked');
  });
  it('refreshes an IBJA draft when a newer snapshot (PM) arrives; autoApprove approves as system:ibja', async () => {
    await seed(); await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    await autoDraftFromIbja(testConfig, { now: NOW });
    await IbjaRate.create({ rateDate: '2026-09-21', session: 'PM', per10g: { '999': '154000', '916': '141000', '750': '115500' }, perGram: { k24: '15400', k22: '14100', k18: '11550' }, source: 'website', fetchedAt: NOW });
    expect(await pickIbjaForDraft('PM')).toMatchObject({ session: 'PM', perGram: { k24: '15400' } });
    const r = await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '18:40') });
    expect(r).toMatchObject({ action: 'drafted', k24: '15400' });
    expect((await Rate.findOne({ date: '2026-09-22' }))!.ibja!.session).toBe('PM');
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoApprove': true });
    const r2 = await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '18:41'), force: true });
    expect(r2.action).toBe('approved');
    expect(await Rate.findOne({ date: '2026-09-22' })).toMatchObject({ status: 'approved', approvedBy: 'system:ibja' });
    // an IBJA-approved rate may still be refreshed by IBJA (it was never touched by a person)
    await IbjaRate.updateOne({ rateDate: '2026-09-21', session: 'PM' }, { 'perGram.k24': '15401', 'per10g.999': '154010' });
    const r3 = await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '18:42'), force: true });
    expect(r3).toMatchObject({ action: 'approved', k24: '15401' });
  });
  it('validation still blocks a bad benchmark (e.g. out of the allowed range) and alerts instead of drafting', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true, priceMax: 12000 });
    await seed();
    const r = await autoDraftFromIbja(testConfig, { now: NOW });
    expect(r.action).toBe('blocked');
    expect((r as any).errors.join()).toMatch(/outside the allowed range/);
    expect(await Rate.countDocuments()).toBe(0);
    expect(await Alert.countDocuments({ type: 'ibja_fetch_failed' })).toBe(1);
  });
  it('drafts TODAY when configured, using the exact IBJA digits', async () => {
    await seed(); await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true, 'ibja.draftFor': 'today' });
    const r = await autoDraftFromIbja(testConfig, { now: NOW });
    expect(r).toMatchObject({ action: 'drafted', date: '2026-09-21' });
  });
});

describe('scheduler integration', () => {
  it('fetches at the configured minutes, catches up a missed slot once, and never twice', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    const deps = { cfg: testConfig, storage: createStorage(testConfig), fetchFn: okHtml, sleep: async () => {} };
    expect((await tick(ist('2026-09-21', '12:39'), deps) as any).ibja).toBeUndefined();
    const t = await tick(ist('2026-09-21', '12:40'), deps) as any;
    expect(t.ibja).toMatchObject({ slot: '12:40', fetched: true, draft: { action: 'drafted', date: '2026-09-22' } });
    expect((await tick(ist('2026-09-21', '12:41'), deps) as any).ibja).toBeUndefined();
    // worker was down at 18:40 → 19:05 tick catches up exactly once
    expect((await tick(ist('2026-09-21', '19:05'), deps) as any).ibja).toMatchObject({ slot: '18:40' });
    expect((await tick(ist('2026-09-21', '19:06'), deps) as any).ibja).toBeUndefined();
    expect(await IbjaFetch.countDocuments()).toBe(2);
  });
  it('disabled → nothing runs', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'ibja.enabled': false });
    expect(await ibjaTick(testConfig, ist('2026-09-21', '12:40'), { fetchFn: okHtml })).toBeNull();
    expect(await IbjaFetch.countDocuments()).toBe(0);
  });
});

describe('API + settings', () => {
  it('latest / history for any user; refresh + draft admin only; settings validate', async () => {
    await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW });
    const l = await staff.get('/api/v1/ibja/latest');
    expect(l.status).toBe(200);
    expect(l.body.latest).toMatchObject({ rateDate: '2026-09-21', session: 'AM', perGram: { k24: '15305.6' } });
    expect(l.body.settings.autoDraft).toBe(false);
    expect((await staff.get('/api/v1/ibja/history?limit=5')).body.items.length).toBeGreaterThan(1);
    expect((await request(app).get('/api/v1/ibja/latest')).status).toBe(401);
    expect((await staff.post('/api/v1/ibja/refresh')).status).toBe(403);
    expect((await staff.post('/api/v1/ibja/draft')).status).toBe(403);
    const d = await admin.post('/api/v1/ibja/draft');
    expect(d.status).toBe(200); expect(d.body).toMatchObject({ action: 'drafted', date: '2026-09-22' });
    expect((await admin.put('/api/v1/settings', { ibja: { autoApprove: true } })).status).toBe(422);
    const ok = await admin.put('/api/v1/settings', { ibja: { autoDraft: true, autoApprove: true, fetchTimes: ['12:45'], preferSession: 'AM' } });
    expect(ok.status).toBe(200); expect(ok.body.settings.ibja).toMatchObject({ autoDraft: true, autoApprove: true, fetchTimes: ['12:45'], preferSession: 'AM' });
    expect((await admin.put('/api/v1/settings', { ibja: { fetchTimes: ['25:00'] } })).status).toBe(422);
  });
  it('the rate DTO shows where the numbers came from', async () => {
    await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW }); await admin.post('/api/v1/ibja/draft');
    const r = await admin.get('/api/v1/rates/2026-09-22');
    expect(r.body.rate).toMatchObject({ source: 'ibja', ibja: { rateDate: '2026-09-21', session: 'AM' }, k24: 15305.6 });
  });
});

describe('hardening from review (2)', () => {
  it('weekend/holiday: blank today table → the newest history snapshot (Friday PM) feeds the draft; a week-old one is stale', async () => {
    const blank = fixture.replace(/(id="lblGold(999|995|916|750|585)_AM"[^>]*>)[^<]*</g, '$1<');
    const sunday = ist('2026-09-20', '12:40');
    const r = await fetchAndStoreIbja(testConfig, { fetchFn: async () => new Response(blank, { status: 200 }), now: sunday, slot: '12:40' });
    expect(r.ok && r.latest).toMatchObject({ rateDate: '2026-09-18', session: 'PM' });
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    expect(await autoDraftFromIbja(testConfig, { now: sunday })).toMatchObject({ action: 'drafted', date: '2026-09-21', from: expect.stringMatching(/IBJA PM rate of 2026-09-18/) });
    // 10 days later the same snapshot must not be used
    const later = ist('2026-09-30', '12:40');
    const st = await autoDraftFromIbja(testConfig, { now: later, force: true });
    expect(st).toMatchObject({ action: 'stale', snapshotDate: '2026-09-18' });
    expect(await Rate.countDocuments({ date: '2026-10-01' })).toBe(0);
    expect(await Alert.countDocuments({ dedupeKey: 'ibja_stale:2026-10-01:2026-09-18' })).toBe(1);
  });
  it('ordering rule compares numbers: a benchmark with 18K below ₹10,000 still drafts', async () => {
    await IbjaRate.create({ rateDate: '2026-09-21', session: 'PM', per10g: { '999': '120000', '916': '110000', '750': '90000' }, perGram: { k24: '12000', k22: '11000', k18: '9000' }, source: 'website', fetchedAt: NOW });
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    expect((await autoDraftFromIbja(testConfig, { now: NOW })).action).toBe('drafted');
    expect((await Rate.findOne({ date: '2026-09-22' }))!.k18).toBe(9000);
  });
  it('an auto-approved IBJA rate is actually sent by the scheduler, and a rate with deliveries is never re-drafted', async () => {
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true, 'ibja.autoApprove': true, 'ibja.draftFor': 'today' });
    await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: ist('2026-09-21', '06:00') });
    expect((await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '06:00') })).action).toBe('approved');
    const deps = { cfg: testConfig, storage: createStorage(testConfig), fetchFn: okHtml, sleep: async () => {} };
    const t = await tick(ist('2026-09-21', '07:00'), deps) as any;
    expect(t.send).toMatchObject({ action: 'sent' });
    expect((await Rate.findOne({ date: '2026-09-21' }))!.status).toBe('sent');
    expect((await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '12:40'), force: true })).action).toBe('sent_locked');
    // partially sent (approved again, one channel already succeeded) → kept
    await Rate.updateOne({ date: '2026-09-21' }, { status: 'approved', approvedBy: 'system:ibja' });
    expect((await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '12:41'), force: true })).action).toBe('kept_partially_sent');
  });
  it('transient failures are retried after 10 min (max 3), permanent ones are not; outage across midnight gets one catch-up', async () => {
    let fail = true;
    const flaky = async () => (fail ? new Response('', { status: 503 }) : okHtml());
    const t1 = await ibjaTick(testConfig, ist('2026-09-21', '12:40'), { fetchFn: flaky });
    expect(t1).toMatchObject({ slot: '12:40', fetched: false });
    expect(await ibjaTick(testConfig, ist('2026-09-21', '12:45'), { fetchFn: flaky })).toBeNull();
    expect(await ibjaTick(testConfig, ist('2026-09-21', '12:50'), { fetchFn: flaky })).toMatchObject({ slot: '12:40', fetched: false });
    fail = false;
    expect(await ibjaTick(testConfig, ist('2026-09-21', '13:00'), { fetchFn: flaky })).toMatchObject({ slot: '12:40', fetched: true });
    expect(await ibjaTick(testConfig, ist('2026-09-21', '13:10'), { fetchFn: flaky })).toBeNull();
    expect(await IbjaFetch.countDocuments({ date: '2026-09-21', slot: '12:40' })).toBe(3);
    // permanent (layout) failure: no retry
    const broken = async () => new Response('<html>nope</html>', { status: 200 });
    expect(await ibjaTick(testConfig, ist('2026-09-21', '18:40'), { fetchFn: broken })).toMatchObject({ fetched: false });
    expect(await ibjaTick(testConfig, ist('2026-09-21', '18:55'), { fetchFn: broken })).toBeNull();
    // worker was down over the 18:40 slot (no attempt at all) → one catch-up next morning before the first slot, then quiet
    await IbjaFetch.deleteMany({ slot: '18:40' });
    expect(await ibjaTick(testConfig, ist('2026-09-22', '08:00'), { fetchFn: okHtml })).toMatchObject({ slot: 'catchup', fetched: true });
    expect(await ibjaTick(testConfig, ist('2026-09-22', '08:01'), { fetchFn: okHtml })).toBeNull();
    // a fresh install (no history) never catches up before its first slot
    await IbjaFetch.deleteMany({});
    expect(await ibjaTick(testConfig, ist('2026-09-23', '08:00'), { fetchFn: okHtml })).toBeNull();
  });
  it('official API: the token never appears in errors, alerts or fetch rows; manual refresh respects the daily quota', async () => {
    const cfg = { ...testConfig, IBJA_SOURCE: 'api' as const, IBJA_API_TOKEN: 'SECRETTOKEN123' };
    const r = await fetchAndStoreIbja(cfg, { fetchFn: async (u: string) => { throw new Error(`connect failed for ${u}`); }, now: NOW });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(await IbjaFetch.find().lean())).not.toContain('SECRETTOKEN123');
    expect(JSON.stringify(await Alert.find().lean())).not.toContain('SECRETTOKEN123');
    await IbjaFetch.insertMany(Array.from({ length: 30 }, (_, i) => ({ date: istDate(NOW), slot: 'manual', at: NOW, ok: true, source: 'api' })));
    const q = await fetchAndStoreIbja(cfg, { fetchFn: okHtml, now: NOW, slot: 'manual' });
    expect(q.ok).toBe(false); expect((q as any).error).toMatch(/quota/);
    // scheduled slots are not blocked by the reserve
    expect((await fetchAndStoreIbja(cfg, { fetchFn: apiRows([{ status: 'success', message: 'No Record Found' }]), now: NOW, slot: '12:40' })).ok).toBe(true);
  });
  it('settings: turning auto-draft off also clears auto-approve; empty fetch times are rejected; oversized numbers are never rates', async () => {
    expect((await admin.put('/api/v1/settings', { ibja: { autoDraft: true, autoApprove: true } })).status).toBe(200);
    const off = await admin.put('/api/v1/settings', { ibja: { autoDraft: false } });
    expect(off.status).toBe(200);
    expect(off.body.settings.ibja).toMatchObject({ autoDraft: false, autoApprove: false });
    expect((await admin.put('/api/v1/settings', { ibja: { fetchTimes: [] } })).status).toBe(422);
    const huge = fixture.replace(/id="lblGold999_PM"[^>]*>/, 'id="lblGold999_PM">1234567890123456');
    expect(parseIbjaHomepage(huge).today.PM).toBeUndefined();
  });
  it('future-dated upstream rows are ignored', async () => {
    const src = new IbjaApiSource({ IBJA_API_TOKEN: 'T', IBJA_API_BASE: 'x' }, apiRows([['999', '153056'], ['916', '140199'], ['750', '114792']].map(([Purity, GoldRate]) => ({ RateDate: '25/09/2026', RateTime: '12AM', Purity, GoldRate }))));
    await expect(src.fetchRecent(NOW)).rejects.toMatchObject({ message: /none matched/ });
  });
});

describe('hardening from review', () => {
  it('the daily-change guard blocks an IBJA draft that moved more than the limit – with and without auto-approve', async () => {
    await Rate.create({ date: '2026-09-21', k24: 10000, k22: 9200, k18: 7500, extraPurities: [], status: 'approved', enteredBy: 'a', approvedBy: 'a' });
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW });
    const r = await autoDraftFromIbja(testConfig, { now: NOW });
    expect(r.action).toBe('blocked');
    expect((r as any).errors.join()).toMatch(/Limit is ±5%/);
    expect(await Rate.countDocuments({ date: '2026-09-22' })).toBe(0);
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoApprove': true });
    expect((await autoDraftFromIbja(testConfig, { now: NOW, force: true })).action).toBe('blocked');
    expect(await Rate.countDocuments({ date: '2026-09-22' })).toBe(0);
    expect(await Alert.countDocuments({ type: 'ibja_fetch_failed', date: '2026-09-22' })).toBe(1);
  });
  it('a cancelled IBJA draft stays cancelled; only the explicit "draft now" button revives it', async () => {
    const { cancelRate } = await import('../src/services/rates');
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoDraft': true });
    await fetchAndStoreIbja(testConfig, { fetchFn: okHtml, now: NOW });
    await autoDraftFromIbja(testConfig, { now: NOW });
    await cancelRate('2026-09-22', 'admin@chheda.test', 'not posting tomorrow');
    expect((await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '18:40') })).action).toBe('cancelled_by_admin');
    await Settings.updateOne({ _id: 'main' }, { 'ibja.autoApprove': true });
    expect((await autoDraftFromIbja(testConfig, { now: ist('2026-09-21', '18:41') })).action).toBe('cancelled_by_admin');
    expect((await Rate.findOne({ date: '2026-09-22' }))!.status).toBe('cancelled');
    const forced = await admin.post('/api/v1/ibja/draft');
    expect(forced.body.action).toBe('approved');
  });
  it('POST /ibja/refresh succeeds through the injected fetch and is rate limited; nothing in tests touches the network', async () => {
    const r = await admin.post('/api/v1/ibja/refresh');
    expect(r.status).toBe(200);
    expect(r.body.latest).toMatchObject({ rateDate: '2026-09-21', session: 'AM' });
    expect(r.headers['ratelimit-limit']).toBeDefined();
    expect((await IbjaFetch.findOne({ slot: 'manual' }))!.by).toBe('admin@chheda.test');
    testFetch.fn = undefined;
    const off = await admin.post('/api/v1/ibja/refresh');
    expect(off.status).toBe(502);
    expect(off.body.error).toMatch(/no network in tests/);
  });
  it('official API: odd bodies, bad rows and spaced RateTime values are tolerated; total mismatch is a permanent error', async () => {
    const mk = (body: any) => new IbjaApiSource({ IBJA_API_TOKEN: 'T', IBJA_API_BASE: 'x' }, async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(mk({ status: 'Invalid', message: 'Invalid Access Token.' }).fetchRecent(NOW)).rejects.toMatchObject({ retryable: false, message: /Invalid Access Token/ });
    await expect(mk('nonsense').fetchRecent(NOW)).rejects.toMatchObject({ retryable: false, message: /unexpected response shape/ });
    const good = (d: string, t: string) => [['999', '153056'], ['916', '140199'], ['750', '114792']].map(([Purity, GoldRate]) => ({ RateDate: d, RateTime: t, Purity, GoldRate }));
    const snaps = await mk({ data: [...good('21/09/2026', '12 AM'), { RateDate: '2026-09-18', RateTime: '6PM', Purity: '999', GoldRate: '1' }, { RateDate: '18/09/2026', RateTime: '6:00 PM', Purity: '999', GoldRate: 'NA' }, ...good('17/09/2026', '6PM').map((r, i) => (i === 0 ? { ...r, GoldRate: '0' } : r))] }).fetchRecent(NOW);
    expect(snaps.map((s) => `${s.rateDate}:${s.session}`)).toEqual(['2026-09-21:AM']);   // bad date row, NA and a zero 999 are skipped, valid day kept
    await expect(mk([{ RateDate: '21/09/2026', RateTime: 'noon', Purity: '999', GoldRate: '153056' }]).fetchRecent(NOW)).rejects.toMatchObject({ retryable: false, message: /none matched/ });
  });
  it('website parser: zero / blank cells never become a rate', () => {
    const zeroed = fixture.replace(/id="lblGold999_PM"[^>]*>/, 'id="lblGold999_PM">0').replace(/id="lblGold916_PM"[^>]*>/, 'id="lblGold916_PM">0').replace(/id="lblGold750_PM"[^>]*>/, 'id="lblGold750_PM">0');
    expect(parseIbjaHomepage(zeroed).today.PM).toBeUndefined();
    expect(parseIbjaHomepage(zeroed).today.AM).toBeDefined();
  });
});
