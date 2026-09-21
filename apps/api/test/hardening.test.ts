import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CloudinaryStorage } from '../src/services/storage/cloudinary';
import { loadConfig } from '../src/config';
import { Session } from '../src/models';
import { login, makeUser, startTestApp, stopTestApp, TEST_ENCRYPTION_KEY } from './setup';

describe('Cloudinary storage adapter (mocked HTTP)', () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const responses: (() => Response)[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => { calls.push({ url, init }); return (responses.shift() ?? (() => new Response('{}', { status: 200 })))(); };
  const st = new CloudinaryStorage({ cloudName: 'demo', apiKey: 'KEY', apiSecret: 'SECRET', folder: 'chheda', fetchFn });
  const key = 'creative/2026-09-18/feed-2026-09-18-abcdef1234567890.jpg';
  it('maps keys to a folder per month and a CDN URL', () => {
    expect(st.publicId(key)).toBe('chheda/creative/2026-09/feed-2026-09-18-abcdef1234567890');
    expect(st.publicUrl(key)).toBe('https://res.cloudinary.com/demo/image/upload/chheda/creative/2026-09/feed-2026-09-18-abcdef1234567890.jpg');
    expect(() => st.publicId('../etc/passwd')).toThrow();
  });
  it('signs uploads (sha1 of sorted params + secret), never overwrites, returns the secure URL', async () => {
    responses.push(() => new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/chheda/creative/2026-09/feed-2026-09-18-abcdef1234567890.jpg', public_id: 'x' }), { status: 200 }));
    const r = await st.save(Buffer.from('jpegdata'), key, 'image/jpeg');
    expect(r).toMatchObject({ key, existed: false, url: expect.stringMatching(/^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\//) });
    const form = calls[0].init!.body as FormData;
    expect(calls[0].url).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(form.get('overwrite')).toBe('false');
    expect(form.get('public_id')).toBe('chheda/creative/2026-09/feed-2026-09-18-abcdef1234567890');
    expect(form.get('api_key')).toBe('KEY');
    const params = { public_id: form.get('public_id') as string, timestamp: Number(form.get('timestamp')), overwrite: false, unique_filename: false, invalidate: false };
    expect(form.get('signature')).toBe(st.sign(params));
    expect(String(form.get('signature'))).toMatch(/^[0-9a-f]{40}$/);
    // an existing asset (sent day) is reported, not replaced
    responses.push(() => new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', existing: true }), { status: 200 }));
    expect((await st.save(Buffer.from('jpegdata'), key, 'image/jpeg')).existed).toBe(true);
    responses.push(() => new Response(JSON.stringify({ error: { message: 'Invalid Signature' } }), { status: 401 }));
    await expect(st.save(Buffer.from('x'), key, 'image/jpeg')).rejects.toThrow(/Invalid Signature/);
  });
  it('exists() uses the admin API with basic auth', async () => {
    responses.push(() => new Response('{}', { status: 404 }));
    expect(await st.exists(key)).toBe(false);
    expect(calls.at(-1)!.url).toContain('/resources/image/upload/');
    expect((calls.at(-1)!.init!.headers as any).Authorization).toBe(`Basic ${Buffer.from('KEY:SECRET').toString('base64')}`);
    responses.push(() => new Response('{}', { status: 200 }));
    expect(await st.exists(key)).toBe(true);
  });
});

describe('config fails fast', () => {
  const base = { NODE_ENV: 'production', MONGO_URI: 'mongodb://x', WEB_ORIGIN: 'https://admin.example.com', MEDIA_BASE_URL: 'https://api.example.com', STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY, SENTRY_DSN: 'https://x@o.ingest.sentry.io/1', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'p', SMTP_HOST: 'smtp' } as any;
  it('accepts a complete production env and lists every problem otherwise', () => {
    expect(() => loadConfig(base)).not.toThrow();
    const bad = () => loadConfig({ ...base, ENCRYPTION_KEY: undefined, WEB_ORIGIN: 'http://x', STORAGE_DRIVER: 'local', MEDIA_BASE_URL: undefined });
    expect(bad).toThrow(/ENCRYPTION_KEY is required/);
    expect(bad).toThrow(/WEB_ORIGIN must be https/);
    expect(bad).toThrow(/STORAGE_DRIVER=local needs MEDIA_BASE_URL/);
    // single-server setup: local images are allowed when they are served over https
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 'local', MEDIA_BASE_URL: 'https://rate.example.com' })).not.toThrow();
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 'local', MEDIA_BASE_URL: 'http://rate.example.com' })).toThrow(/MEDIA_BASE_URL must be https/);
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: 'short' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, DRY_RUN: 'false' })).toThrow(/META_APP_SECRET/);
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 'cloudinary', CLOUDINARY_API_SECRET: undefined })).toThrow(/CLOUDINARY/);
    expect(() => loadConfig({ ...base, DEV_AUTO_LOGIN_EMAIL: 'admin@x.test' })).toThrow(/DEV_AUTO_LOGIN_EMAIL must not be set in production/);
  });
});

describe('sessions & security', () => {
  let app: any;
  beforeAll(async () => { app = await startTestApp(); await makeUser('admin@chheda.test', 'admin'); });
  afterAll(stopTestApp);
  it('change-password verifies the current one, enforces strength and ends other sessions', async () => {
    const a = await login(app, 'admin@chheda.test'); const b = await login(app, 'admin@chheda.test');
    expect((await a.post('/api/v1/auth/change-password', { currentPassword: 'wrong', newPassword: 'NewStr0ngPassw0rd' })).status).toBe(401);
    expect((await a.post('/api/v1/auth/change-password', { currentPassword: 'Str0ngPassw0rd', newPassword: 'weak' })).status).toBe(422);
    expect((await a.post('/api/v1/auth/change-password', { currentPassword: 'Str0ngPassw0rd', newPassword: 'NewStr0ngPassw0rd' })).status).toBe(200);
    expect((await a.get('/api/v1/auth/me')).status).toBe(200);   // the session that changed it stays
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);   // every other session is gone
    expect(await Session.countDocuments()).toBe(1);
    await expect(login(app, 'admin@chheda.test', 'Str0ngPassw0rd')).rejects.toThrow();
    const c = await login(app, 'admin@chheda.test', 'NewStr0ngPassw0rd');
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);
  });
  it('responses carry a request id and errors never leak stack traces', async () => {
    const r = await request(app).get('/api/v1/nope');
    expect(r.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts|node_modules/);
    const echoed = await request(app).get('/health').set('x-request-id', 'trace-123');
    expect(echoed.headers['x-request-id']).toBe('trace-123');
  });
  it('webhooks are rate limited (headers present) and unauthenticated API routes stay closed', async () => {
    const r = await request(app).post('/api/v1/webhooks/whatsapp').send({});
    expect(r.status).toBe(401);
    expect(r.headers['ratelimit-limit']).toBeDefined();
    for (const p of ['/api/v1/rates', '/api/v1/settings', '/api/v1/deliveries', '/api/v1/alerts', '/api/v1/integrations', '/api/v1/subscribers', '/api/v1/staff/today', '/api/v1/users', '/api/v1/audit']) expect((await request(app).get(p)).status, p).toBe(401);
  });
});
