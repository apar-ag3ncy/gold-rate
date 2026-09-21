/**
 * Vercel entry point: the whole Express API as one serverless function (apps/api/vercel.json rewrites every path here).
 * Connects to MongoDB once per cold start and reuses the connection while the instance is warm. See docs/DEPLOY-VERCEL.md.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../src/config';
import { connectDb } from '../src/db';
import { createApp, setSentryCapture } from '../src/app';
import { initSentry } from '../src/lib/sentry';
import { logger } from '../src/lib/logger';

const ready = (async () => {
  const cfg = loadConfig();
  const Sentry = await initSentry(cfg, 'api');
  if (Sentry) setSentryCapture((err, ctx) => Sentry.captureException(err, { extra: ctx }));
  await connectDb(cfg.MONGO_URI);
  logger.info({ dryRun: cfg.DRY_RUN, storage: cfg.STORAGE_DRIVER }, 'API ready (serverless)');
  return createApp(cfg);
})();
ready.catch((err) => logger.error({ err }, 'API failed to start – check the environment variables'));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  app(req, res);
}
