import { Router } from 'express';
import { z } from 'zod';
import { dateParamSchema, istDate } from '@chheda/shared';
import { Delivery, SendDay } from '../models';
import { requireAuth } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { deliveryToDTO } from '../services/deliveries';
import { markPosted } from '../services/staff';
import { keywordReplyLog } from '../services/keywordReply';
import { audit } from '../lib/audit';
import { requireRole } from '../middleware/auth';

const listQuery = z.object({ date: dateParamSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export function deliveriesRouter() {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const date = q.date ?? istDate();
    // channel-level rows only; per-recipient WhatsApp rows are summarised in `whatsapp`
    const [items, day, wa] = await Promise.all([
      Delivery.find({ date, recipientHash: { $exists: false } }).sort({ createdAt: -1 }).limit(q.limit).lean(),
      SendDay.findOne({ date }).lean(),
      Delivery.aggregate([{ $match: { date, recipientHash: { $exists: true } } }, { $group: { _id: '$status', n: { $sum: 1 }, delivered: { $sum: { $cond: [{ $in: ['$waStatus', ['delivered', 'read']] }, 1, 0] } }, read: { $sum: { $cond: [{ $eq: ['$waStatus', 'read'] }, 1, 0] } } } }]),
    ]);
    const whatsapp = { recipients: 0, sent: 0, failed: 0, queued: 0, delivered: 0, read: 0 };
    for (const g of wa) { whatsapp.recipients += g.n; if (g._id === 'success') whatsapp.sent += g.n; else if (g._id === 'failed') whatsapp.failed += g.n; else whatsapp.queued += g.n; whatsapp.delivered += g.delivered; whatsapp.read += g.read; }
    res.json({ date, items: items.map(deliveryToDTO), whatsapp, day: day ? { status: day.status, reason: day.reason, attempts: day.attempts ?? 0, lastCheckAt: day.lastCheckAt, sentAt: day.sentAt, healthCheckAt: day.healthCheckAt } : null });
  });
  /** Phase 5: keyword auto-replies – today's count + last 50 (masked senders). */
  r.get('/keyword', async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    res.json(await keywordReplyLog(limit));
  });
  r.post('/:id/mark-posted', requireRole('staff', 'admin'), async (req, res) => {
    const id = parse(z.string().regex(/^[0-9a-f]{24}$/), req.params.id);
    const d = await markPosted(id, req.user!);
    await audit(req, 'manual_posted', 'delivery', id, undefined, { channel: d.channel, date: d.date });
    res.json({ item: deliveryToDTO(d) });
  });
  return r;
}
