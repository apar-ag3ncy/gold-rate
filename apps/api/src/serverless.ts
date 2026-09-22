/**
 * Serverless entry helper: build the Express app once per process (cold start) and reuse it while the instance is warm.
 * Used by apps/web/pages/api/[...path].ts (the API inside the Next.js project on Vercel) and apps/api/api/index.ts.
 */
import { loadConfig } from './config';
import { connectDb } from './db';
import { createApp, setSentryCapture } from './app';
import { initSentry } from './lib/sentry';
import { logger } from './lib/logger';

let ready: Promise<ReturnType<typeof createApp>> | undefined;

export function getApi() {
  ready ??= (async () => {
    const cfg = loadConfig();
    const Sentry = await initSentry(cfg, 'api');
    if (Sentry) setSentryCapture((err, ctx) => Sentry.captureException(err, { extra: ctx }));
    await connectDb(cfg.MONGO_URI);
    logger.info({ dryRun: cfg.DRY_RUN, storage: cfg.STORAGE_DRIVER }, 'API ready (serverless)');
    return createApp(cfg);
  })();
  // a failed start (bad env) must not poison every later request: retry on the next call
  ready.catch((err) => { logger.error({ err }, 'API failed to start – check the environment variables'); ready = undefined; });
  return ready;
}
