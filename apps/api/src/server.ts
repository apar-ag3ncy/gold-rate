import mongoose from 'mongoose';
import { loadConfig } from './config';
import { connectDb } from './db';
import { createApp, setSentryCapture } from './app';
import { initSentry } from './lib/sentry';
import { logger } from './lib/logger';

const cfg = loadConfig();
const Sentry = await initSentry(cfg, 'api');
if (Sentry) setSentryCapture((err, ctx) => Sentry.captureException(err, { extra: ctx }));
await connectDb(cfg.MONGO_URI);
const server = createApp(cfg).listen(cfg.API_PORT, () => logger.info(`API listening on :${cfg.API_PORT} (DRY_RUN=${cfg.DRY_RUN})`));

const shutdown = async (sig: string) => {
  logger.info(`${sig} received, shutting down`);
  server.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => { logger.error({ err }, 'unhandledRejection'); Sentry?.captureException(err); });
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'uncaughtException'); Sentry?.captureException(err); setTimeout(() => process.exit(1), 500); });
