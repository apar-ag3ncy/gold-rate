import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { dateParamSchema, istDate } from '@chheda/shared';
import type { Config } from '../config';
import { audit } from '../lib/audit';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { sendTest } from '../services/deliveries';
import { sendNow } from '../services/scheduler';
import type { StorageAdapter } from '../services/storage';

const testSchema = z.object({ date: dateParamSchema.optional() });

export function sendRouter(cfg: Config, storage: StorageAdapter) {
  const r = Router();
  r.use(requireRole('admin'));

  /** Test Send → admin only, never customers. DRY_RUN logs it. */
  r.post('/test', rateLimit({ windowMs: 10 * 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const { date = istDate() } = parse(testSchema, req.body ?? {});
    const out = await sendTest(cfg, storage, date, { email: req.user!.email, name: req.user!.name });
    await audit(req, 'send_test', 'delivery', out.delivery.id, undefined, { date, channel: out.delivery.channel, recipient: out.delivery.recipient, dryRun: out.dryRun });
    res.json(out);
  });

  /** Send Now → same rule as the scheduler (today + approved only). Retries failed channels, never repeats successful ones. */
  r.post('/now', rateLimit({ windowMs: 10 * 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 5, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const now = new Date();
    const result = await sendNow(now, { cfg, storage });
    await audit(req, 'send_now', 'rate', istDate(now), undefined, result);
    const status = result.action === 'rate_missing' ? 409 : result.action === 'locked' ? 423 : 200;
    res.status(status).json({ date: istDate(now), dryRun: cfg.DRY_RUN, result });
  });

  return r;
}
