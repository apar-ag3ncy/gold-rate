import mongoose from 'mongoose';
import { loadConfig } from './config';
import { connectDb } from './db';
import { createApp } from './app';
import { logger } from './lib/logger';

const cfg = loadConfig();
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
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
