import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { User } from '../src/models';
import { hashPassword } from '../src/lib/auth';

let mem: MongoMemoryServer | undefined;
export const TEST_MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chheda-media-'));

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_APP_SECRET = 'test-app-secret';
export let testConfig: ReturnType<typeof loadConfig>;
/** Outbound HTTP from routes in tests: set `testFetch.fn` per test; anything else fails loudly (no network in tests). */
export const testFetch: { fn?: (url: string, init?: RequestInit) => Promise<Response> } = {};

export async function startTestApp(extraEnv: Record<string, string> = {}) {
  let uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mem = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
    uri = mem.getUri('chheda_test');
  }
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  // TTL indexes aren't supported by the lightweight FerretDB used in some CI sandboxes; ignore only that.
  for (const m of Object.values(mongoose.models)) await m.syncIndexes().catch((e) => { if (!/expireAfterSeconds/.test(e.message)) throw e; });
  process.env.ENCRYPTION_KEY ??= TEST_ENCRYPTION_KEY;
  const cfg = loadConfig({ NODE_ENV: 'test', MONGO_URI: uri, WEB_ORIGIN: 'http://localhost:3000', MEDIA_DIR: TEST_MEDIA_DIR, MEDIA_BASE_URL: 'http://localhost:4000', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY, META_APP_SECRET: TEST_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN: 'verify-me', ...extraEnv } as any);
  testConfig = cfg;
  return createApp(cfg, { fetchFn: (u, i) => { if (!testFetch.fn) throw new Error(`no network in tests (${u})`); return testFetch.fn(u, i); } });
}

export async function stopTestApp() {
  await mongoose.disconnect();
  await mem?.stop();
  fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true });
}

export async function makeUser(email: string, role: 'admin' | 'staff' | 'viewer', password = 'Str0ngPassw0rd') {
  await User.create({ email, name: email.split('@')[0], role, passwordHash: await hashPassword(password) });
}

/** Logged-in agent that sends the CSRF header automatically. */
export async function login(app: any, email: string, password = 'Str0ngPassw0rd') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-requested-with', 'chheda-web').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const h = { 'x-requested-with': 'chheda-web' };
  return {
    get: (u: string) => agent.get(u),
    put: (u: string, b?: object) => agent.put(u).set(h).send(b),
    post: (u: string, b?: object) => agent.post(u).set(h).send(b),
    delete: (u: string) => agent.delete(u).set(h),
    patch: (u: string, b?: object) => agent.patch(u).set(h).send(b),
  };
}
