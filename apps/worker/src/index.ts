/**
 * Scheduler worker (SPEC §6). Runs tick() every minute in Asia/Kolkata:
 *  - sendTime − 30 min: health check → alert if today's rate is not ready
 *  - sendTime and every 15 min until the cutoff: send today's APPROVED rate (never an old one)
 *  - cutoff: close the day and alert if nothing went out
 * A Mongo job lock keeps multiple workers from sending twice; idempotency keys make re-runs safe.
 * Exposes GET /health and GET /ready on WORKER_PORT for systemd / uptime monitors.
 */
import http from 'node:http';
import cron from 'node-cron';
import mongoose from 'mongoose';
import { loadConfig } from '@chheda/api/config';
import { connectDb } from '@chheda/api/db';
import { logger } from '@chheda/api/lib/logger';
import { initSentry } from '@chheda/api/lib/sentry';
import { createStorage } from '@chheda/api/services/storage/index';
import { recoverMissedRun, tick } from '@chheda/api/services/scheduler';
import { withLock } from '@chheda/api/services/lock';
import { getSettings, Integration } from '@chheda/api/models/index';
import { setAlertNotifier } from '@chheda/api/services/alerts';

const cfg = loadConfig();
const Sentry = await initSentry(cfg, 'worker');
await connectDb(cfg.MONGO_URI);
setAlertNotifier(cfg);
const deps = { cfg, storage: createStorage(cfg) };
const s = await getSettings();
logger.info({ sendTime: s.sendTime, cutoffTime: s.cutoffTime, automationOn: s.automationOn, dryRun: cfg.DRY_RUN, version: cfg.APP_VERSION }, 'Worker starting (Asia/Kolkata)');

const state = { startedAt: new Date(), lastTickAt: null as Date | null, lastTickOk: true, lastTickError: '' as string, ticks: 0 };

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
    state.lastTickAt = new Date(); state.lastTickOk = true; state.lastTickError = ''; state.ticks++;
    if (r.ran && (r.result.send || r.result.healthCheck || r.result.closed)) logger.info(r.result, 'tick');
  } catch (err: any) {
    state.lastTickAt = new Date(); state.lastTickOk = false; state.lastTickError = err?.message ?? String(err);
    logger.error({ err }, 'tick failed'); Sentry?.captureException(err);
  } finally { running = false; }
}, { timezone: 'Asia/Kolkata' });

// /health = process up; /ready = DB up + a tick in the last 3 minutes + (live mode) connections not in error
const server = http.createServer(async (req, res) => {
  const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return json(200, { ok: true, service: 'worker', version: cfg.APP_VERSION, uptimeSec: Math.round((Date.now() - state.startedAt.getTime()) / 1000) });
  if (req.url === '/ready') {
    const db = mongoose.connection.readyState === 1;
    const tickFresh = !!state.lastTickAt && Date.now() - state.lastTickAt.getTime() < 3 * 60_000;
    const ints = cfg.DRY_RUN ? [] : await Integration.find().lean().catch(() => []);
    const tokens = ints.map((i) => ({ channel: i.channel, status: i.status, expiresAt: i.expiresAt }));
    const tokensOk = tokens.every((t) => t.status === 'connected' && (!t.expiresAt || t.expiresAt > new Date()));
    const ok = db && (tickFresh || state.ticks === 0 && Date.now() - state.startedAt.getTime() < 90_000) && (cfg.DRY_RUN || tokensOk);
    return json(ok ? 200 : 503, { ok, db, lastTickAt: state.lastTickAt, lastTickOk: state.lastTickOk, lastTickError: state.lastTickError || undefined, ticks: state.ticks, dryRun: cfg.DRY_RUN, tokens });
  }
  json(404, { error: 'Not found' });
});
server.listen(cfg.WORKER_PORT, () => logger.info(`Worker health on :${cfg.WORKER_PORT} (/health, /ready)`));

const shutdown = async (sig: string) => {
  logger.info(`${sig} received – stopping worker`);
  await task.stop();
  server.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => { logger.error({ err }, 'unhandledRejection'); Sentry?.captureException(err); });
