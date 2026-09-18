import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { dateParamSchema, istDate } from '@chheda/shared';
import type { Config } from '../config';
import { audit } from '../lib/audit';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { sendTest } from '../services/deliveries';
import { Delivery, Rate, Subscriber, getSettings } from '../models';
import { AUTO_CHANNELS, MANUAL_CHANNELS } from '../services/publishers';
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

  /** What "Send Now" would do right now – for the confirmation dialog. Nothing is sent. */
  r.get('/plan', async (_req, res) => {
    const date = istDate();
    const [s, rate, done, subscribers] = await Promise.all([getSettings(), Rate.findOne({ date }).lean(), Delivery.find({ date, recipientHash: { $exists: false }, status: 'success' }).lean(), Subscriber.countDocuments({ status: 'active' })]);
    const sent = new Set(done.map((d) => d.channel));
    const toggles: Record<string, boolean> = { ig_feed: s.channels?.igFeed !== false, ig_story: s.channels?.igStory !== false, wa_customers: s.channels?.waCustomers !== false };
    const channels = [...AUTO_CHANNELS.map((c) => ({ channel: c, enabled: toggles[c], alreadySent: sent.has(c), recipients: c === 'wa_customers' ? subscribers : undefined })),
      ...MANUAL_CHANNELS.map((c) => ({ channel: c, enabled: s.channels?.staffShare !== false, alreadySent: sent.has(c), manual: true }))];
    const canSend = !!rate && rate.status === 'approved';
    res.json({ date, dryRun: cfg.DRY_RUN, canSend, reason: !rate ? 'No rate entered for today.' : rate.status === 'sent' ? 'Already sent on every automatic channel.' : rate.status !== 'approved' ? `Today's rate is ${rate.status} – approve it first.` : undefined,
      rate: rate ? { k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities, status: rate.status } : null, subscribers, channels });
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
