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
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
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
});

export type Config = z.infer<typeof schema> & { MEDIA_BASE_URL: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && !cfg.WEB_ORIGIN.startsWith('https://')) {
    throw new Error('WEB_ORIGIN must be https in production');
  }
  if (cfg.STORAGE_DRIVER === 's3' && (!cfg.S3_BUCKET || !cfg.S3_REGION)) {
    throw new Error('S3_BUCKET and S3_REGION are required when STORAGE_DRIVER=s3');
  }
  if (cfg.NODE_ENV === 'production' && !cfg.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required in production');
  if (!cfg.DRY_RUN && (!cfg.META_APP_SECRET || !cfg.META_WEBHOOK_VERIFY_TOKEN)) {
    throw new Error('DRY_RUN=false needs META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN');
  }
  if (cfg.NODE_ENV === 'production' && cfg.STORAGE_DRIVER === 'local' && !cfg.MEDIA_BASE_URL) {
    throw new Error('MEDIA_BASE_URL is required in production (Instagram must be able to fetch the image)');
  }
  return { ...cfg, MEDIA_BASE_URL: (cfg.MEDIA_BASE_URL ?? `http://localhost:${cfg.API_PORT}`).replace(/\/+$/, '') };
}
