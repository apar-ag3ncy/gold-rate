import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(168).default(12),
  DRY_RUN: z.string().default('true').transform((v) => v !== 'false'),

  // ---- media storage (Phase 2) ----
  STORAGE_DRIVER: z.enum(['local', 's3', 'cloudinary']).default('local'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('chheda'),
  /** Local driver: directory where JPEGs are written. Served by the API at /media. */
  MEDIA_DIR: z.string().default(path.resolve(process.cwd(), 'uploads')),
  /** Public base URL for the API (used to build image URLs with the local driver). */
  MEDIA_BASE_URL: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_PREFIX: z.string().default(''),
  /** e.g. a CloudFront/Cloudinary domain; defaults to the bucket's virtual-host URL */
  S3_PUBLIC_BASE_URL: z.string().optional(),

  // ---- Meta (Phase 4) ----
  /** 32-byte base64 key for AES-256-GCM (tokens, phone numbers). Required whenever those features are used. */
  ENCRYPTION_KEY: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'e.g. v21.0').default('v21.0'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WA_SEND_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  WA_SEND_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(100),
  IG_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),

  // ---- Web push + email (Phase 4B) ----
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@chhedajewellers.com'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.string().default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** Public URL of the dashboard – used in push notifications and alert emails. */
  WEB_PUBLIC_URL: z.string().optional(),

  // ---- Observability (Phase 7) ----
  SENTRY_DSN: z.string().optional(),
  APP_VERSION: z.string().optional(),        // release tag (git sha) – set by the deploy script / CI
  WORKER_PORT: z.coerce.number().int().default(4100),
  // ---- IBJA benchmark rates ----
  /** api = official IBJA Rates API (subscription, indiagoldratesapi.com) · website = parse ibjarates.com (trial / fallback only) */
  IBJA_SOURCE: z.enum(['api', 'website']).default('website'),
  IBJA_API_TOKEN: z.string().optional(),
  IBJA_API_BASE: z.string().default('https://ibjarates.com'),      // https://uat.ibjarates.com for the UAT key
  IBJA_WEBSITE_URL: z.string().default('https://ibjarates.com/'),
  /** No login screen: every request without a session runs as this user. Anyone who can reach the dashboard acts as them – keep the address private. */
  AUTO_LOGIN_EMAIL: z.string().email().optional(),
  /** Older name for AUTO_LOGIN_EMAIL (still accepted). */
  DEV_AUTO_LOGIN_EMAIL: z.string().email().optional(),
});

export type Config = z.infer<typeof schema> & { MEDIA_BASE_URL: string; WEB_PUBLIC_URL: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  const cfg = parsed.data;
  if (cfg.STORAGE_DRIVER === 's3' && (!cfg.S3_BUCKET || !cfg.S3_REGION)) {
    throw new Error('S3_BUCKET and S3_REGION are required when STORAGE_DRIVER=s3');
  }
  const problems: string[] = [];
  if (cfg.NODE_ENV === 'production') {
    if (cfg.AUTO_LOGIN_EMAIL ?? cfg.DEV_AUTO_LOGIN_EMAIL) console.warn('WARN: AUTO_LOGIN_EMAIL is set – there is no login screen; anyone who can open the dashboard acts as that user');
    if (!cfg.ENCRYPTION_KEY) problems.push('ENCRYPTION_KEY is required (openssl rand -base64 32)');
    if (!cfg.WEB_ORIGIN.startsWith('https://')) problems.push('WEB_ORIGIN must be https');
    if (cfg.MEDIA_BASE_URL && !cfg.MEDIA_BASE_URL.startsWith('https://')) problems.push('MEDIA_BASE_URL must be https (Instagram fetches images from it)');
    // local storage is fine on a single always-on server as long as the images are reachable over https (Instagram fetches them)
    if (cfg.STORAGE_DRIVER === 'local' && !cfg.MEDIA_BASE_URL) problems.push('STORAGE_DRIVER=local needs MEDIA_BASE_URL=https://<your domain> (the API serves the images at /media)');
    if (cfg.STORAGE_DRIVER === 'local' && cfg.MEDIA_BASE_URL?.startsWith('https://')) console.warn('WARN: STORAGE_DRIVER=local – images live on this server only (fine for one server; use cloudinary for a CDN)');
    if (!cfg.SENTRY_DSN) console.warn('WARN: SENTRY_DSN is not set – errors will only be in the logs');
    if (!cfg.VAPID_PUBLIC_KEY) console.warn('WARN: VAPID keys not set – staff push notifications are disabled');
    if (!cfg.SMTP_HOST) console.warn('WARN: SMTP_HOST not set – admin alert emails are disabled');
  }
  if (cfg.IBJA_SOURCE === 'api' && !cfg.IBJA_API_TOKEN) problems.push('IBJA_SOURCE=api needs IBJA_API_TOKEN');
  if (cfg.NODE_ENV === 'production' && cfg.IBJA_SOURCE === 'website') console.warn('WARN: IBJA_SOURCE=website – IBJA asks commercial users to subscribe to the official API (indiagoldratesapi.com)');
  if (cfg.STORAGE_DRIVER === 'cloudinary' && (!cfg.CLOUDINARY_CLOUD_NAME || !cfg.CLOUDINARY_API_KEY || !cfg.CLOUDINARY_API_SECRET)) problems.push('STORAGE_DRIVER=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET');
  if (cfg.ENCRYPTION_KEY && Buffer.from(cfg.ENCRYPTION_KEY, 'base64').length !== 32) problems.push('ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32)');
  if (problems.length) throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  if (!cfg.DRY_RUN && (!cfg.META_APP_SECRET || !cfg.META_WEBHOOK_VERIFY_TOKEN)) {
    throw new Error('DRY_RUN=false needs META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN');
  }
  return { ...cfg, MEDIA_BASE_URL: (cfg.MEDIA_BASE_URL ?? `http://localhost:${cfg.API_PORT}`).replace(/\/+$/, ''), WEB_PUBLIC_URL: (cfg.WEB_PUBLIC_URL ?? cfg.WEB_ORIGIN).replace(/\/+$/, '') };
}
