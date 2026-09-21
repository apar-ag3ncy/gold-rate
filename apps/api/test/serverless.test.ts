import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { MongoStorage } from '../src/services/storage';
import { login, makeUser, startTestApp, stopTestApp, testConfig } from './setup';

/** Serverless hosting (Vercel): images in MongoDB served at /media, and the cron-called scheduler tick. */
describe('mongo storage + cron tick', () => {
  let app: any;
  const SECRET = 'a-long-cron-secret-123';
  beforeAll(async () => { app = await startTestApp({ STORAGE_DRIVER: 'mongo', CRON_SECRET: SECRET }); await makeUser('admin@chheda.test', 'admin'); });
  afterAll(stopTestApp);

  it('stores an image once in MongoDB and serves it at /media with long caching', async () => {
    const st = new MongoStorage('http://localhost:4000');
    const key = 'creative/2026-09-21/feed-2026-09-21-abc.jpg';
    const first = await st.save(Buffer.from('jpegbytes'), key, 'image/jpeg');
    expect(first).toEqual({ key, url: `http://localhost:4000/media/${key}`, existed: false });
    expect((await st.save(Buffer.from('DIFFERENT'), key, 'image/jpeg')).existed).toBe(true);   // never overwritten
    expect(await st.exists(key)).toBe(true);
    expect(await st.exists('creative/2026-09-21/nope.jpg')).toBe(false);
    await expect(st.save(Buffer.from('x'), '../etc/passwd', 'image/jpeg')).rejects.toThrow(/Unsafe/);

    const res = await request(app).get(`/media/${key}`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((res.body as Buffer).toString()).toBe('jpegbytes');          // the first bytes, not the second save
    expect((await request(app).head(`/media/${key}`)).status).toBe(200);
    expect((await request(app).get('/media/creative/2026-09-21/nope.jpg')).status).toBe(404);
    expect((await request(app).get('/media/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
  });

  it('preview renders through the mongo driver and the image is fetchable', async () => {
    const a = await login(app, 'admin@chheda.test');
    const r = await a.post('/api/v1/preview', { date: '2026-09-22', k24: '15305.6', k22: '14019.9', k18: '11479.2', extraPurities: [], overrideReason: '' });
    expect(r.status).toBe(200);
    expect(r.body.feedUrl).toMatch(/^http:\/\/localhost:4000\/media\/preview\/2026-09-22\/feed-2026-09-22-[0-9a-f]{16}\.jpg$/);
    const img = await request(app).get(new URL(r.body.feedUrl).pathname);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Number(img.headers['content-length'])).toBeGreaterThan(10_000);
  });

  it('tick endpoint needs the secret and then runs the scheduler minute tick', async () => {
    expect((await request(app).get('/api/v1/internal/tick')).status).toBe(401);
    expect((await request(app).get('/api/v1/internal/tick').set('authorization', 'Bearer wrong-secret-value-1')).status).toBe(401);
    expect((await request(app).post('/api/v1/internal/tick').set('x-cron-secret', 'nope')).status).toBe(401);
    const ok = await request(app).get('/api/v1/internal/tick').set('authorization', `Bearer ${SECRET}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.ran).toBe(true);
    expect(ok.body.tick.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ok.body.tick.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('is hidden when CRON_SECRET is not configured', async () => {
    const bare = createApp({ ...testConfig, CRON_SECRET: undefined });
    expect((await request(bare).get('/api/v1/internal/tick').set('authorization', `Bearer ${SECRET}`)).status).toBe(404);
  });
});
