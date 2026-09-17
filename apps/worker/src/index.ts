/**
 * Scheduler worker (SPEC §6). Runs tick() every minute in Asia/Kolkata:
 *  - sendTime − 30 min: health check → alert if today's rate is not ready
 *  - sendTime and every 15 min until the cutoff: send today's APPROVED rate (never an old one)
 *  - cutoff: close the day and alert if nothing went out
 * A Mongo job lock keeps multiple workers from sending twice; idempotency keys make re-runs safe.
 */
import cron from 'node-cron';
import mongoose from 'mongoose';
import { loadConfig } from '@chheda/api/config';
import { connectDb } from '@chheda/api/db';
import { logger } from '@chheda/api/lib/logger';
import { createStorage } from '@chheda/api/services/storage/index';
import { recoverMissedRun, tick } from '@chheda/api/services/scheduler';
import { withLock } from '@chheda/api/services/lock';
import { getSettings } from '@chheda/api/models/index';

const cfg = loadConfig();
await connectDb(cfg.MONGO_URI);
const deps = { cfg, storage: createStorage(cfg) };
const s = await getSettings();
logger.info({ sendTime: s.sendTime, cutoffTime: s.cutoffTime, automationOn: s.automationOn, dryRun: cfg.DRY_RUN }, 'Worker starting (Asia/Kolkata)');

// Missed-run recovery: if the process starts inside today's window and nothing was sent, run immediately.
const recovered = await recoverMissedRun(new Date(), deps);
logger.info({ recovered }, 'Missed-run recovery finished');

let running = false;
const task = cron.schedule('* * * * *', async () => {
  if (running) return; // never overlap ticks inside one process
  running = true;
  try {
    // 50 s lock: one tick per minute across all worker instances
    const r = await withLock('scheduler-tick', 50_000, () => tick(new Date(), deps));
    if (r.ran && (r.result.send || r.result.healthCheck || r.result.closed)) logger.info(r.result, 'tick');
  } catch (err) {
    logger.error({ err }, 'tick failed');
  } finally { running = false; }
}, { timezone: 'Asia/Kolkata' });

const shutdown = async (sig: string) => {
  logger.info(`${sig} received – stopping worker`);
  await task.stop();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
