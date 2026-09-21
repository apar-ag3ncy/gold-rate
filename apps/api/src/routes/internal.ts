import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config';
import { HttpError, notFound } from '../lib/errors';
import { SendDay } from '../models';
import { withLock } from '../services/lock';
import { recoverMissedRun, tick, type SchedulerDeps } from '../services/scheduler';
import type { StorageAdapter } from '../services/storage';
import { istDate } from '@chheda/shared';

/**
 * Serverless hosting has no always-on worker. A free cron service (cron-job.org, every minute) or Vercel Cron calls
 * GET /api/v1/internal/tick with `Authorization: Bearer <CRON_SECRET>` and this runs exactly what the worker's minute tick runs.
 * Hidden (404) unless CRON_SECRET is configured. The Mongo job lock keeps overlapping calls from double-sending.
 */
export function internalRouter(cfg: Config, deps: { storage: StorageAdapter; fetchFn?: SchedulerDeps['fetchFn'] }) {
  const r = Router();
  const handler = async (req: any, res: any) => {
    if (!cfg.CRON_SECRET) throw notFound('Route not found');
    const auth = String(req.get('authorization') ?? '');
    const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.get('x-cron-secret') ?? '');
    const a = Buffer.from(given), b = Buffer.from(cfg.CRON_SECRET);
    if (!given || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Bad cron secret');
    const now = new Date();
    const sched: SchedulerDeps = { cfg, storage: deps.storage, fetchFn: deps.fetchFn };
    const t = await withLock('scheduler-tick', 50_000, () => tick(now, sched));
    // External cron calls can arrive a minute late and miss the exact send minute: if today has no attempt yet and we are
    // inside the send window, run the same missed-run recovery the worker does on start-up (idempotent, never an old rate).
    let recovery: string | undefined;
    if (t.ran && !t.result.send) {
      const day = await SendDay.findOne({ date: istDate(now) }).lean();
      if (!day || day.status === 'pending') recovery = (await recoverMissedRun(now, sched)).action;
    }
    res.json({ ok: true, ran: t.ran, tick: t.ran ? t.result : undefined, recovery });
  };
  r.get('/tick', handler);
  r.post('/tick', handler);
  return r;
}
