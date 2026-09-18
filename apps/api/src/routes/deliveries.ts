import { Router } from 'express';
import { z } from 'zod';
import { dateParamSchema, DELIVERY_CHANNELS, DELIVERY_STATUSES, DELIVERY_TRIGGERS, istDate, addDays } from '@chheda/shared';
import { Delivery, SendDay } from '../models';
import { requireAuth } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { deliveryToDTO } from '../services/deliveries';
import { markPosted } from '../services/staff';
import { keywordReplyLog } from '../services/keywordReply';
import { audit } from '../lib/audit';
import { requireRole } from '../middleware/auth';

const listQuery = z.object({ date: dateParamSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const logQuery = z.object({
  from: dateParamSchema.optional(), to: dateParamSchema.optional(),
  channel: z.enum(DELIVERY_CHANNELS).optional(), status: z.enum(DELIVERY_STATUSES).optional(), trigger: z.enum(DELIVERY_TRIGGERS).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50),
});
const logFilter = (q: z.infer<typeof logQuery>) => {
  const f: Record<string, unknown> = { recipientHash: { $exists: false } };
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.channel) f.channel = q.channel;
  if (q.status) f.status = q.status;
  if (q.trigger) f.trigger = q.trigger;
  if (q.channel === 'wa_keyword' || q.channel === 'ig_keyword' || q.trigger === 'keyword') delete f.recipientHash; // keyword rows carry a sender hash
  return f;
};
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

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
  /** Phase 6: filtered + paginated log (channel-level rows; WhatsApp per-recipient rows are excluded unless filtering keyword rows). */
  r.get('/log', async (req, res) => {
    const q = parse(logQuery, req.query);
    const f = logFilter({ from: q.from ?? addDays(istDate(), -30), ...q });
    const [total, items] = await Promise.all([Delivery.countDocuments(f), Delivery.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean()]);
    res.json({ total, page: q.page, limit: q.limit, items: items.map(deliveryToDTO) });
  });
  /** CSV export of the same filter (max 5,000 rows). */
  r.get('/export.csv', async (req, res) => {
    const q = parse(logQuery.omit({ page: true, limit: true }), req.query);
    const f = logFilter({ from: q.from ?? addDays(istDate(), -30), ...q, page: 1, limit: 1 });
    const rows = await Delivery.find(f).sort({ createdAt: -1 }).limit(5000).lean();
    const header = ['date', 'channel', 'trigger', 'status', 'createdAt', 'attempts', 'externalId', 'recipient', 'postedBy', 'postedAt', 'metaErrorCode', 'error', 'dryRun'];
    const lines = [header.join(','), ...rows.map((d) => [d.date, d.channel, d.trigger, d.status, d.createdAt?.toISOString(), d.attempts ?? 0, d.externalId, d.recipientMasked ?? d.recipient, d.postedBy, d.postedAt?.toISOString(), d.metaErrorCode, d.error, d.dryRun].map(csvCell).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deliveries-${q.from ?? 'last30d'}-to-${q.to ?? istDate()}.csv"`);
    res.send(`\uFEFF${lines.join('\n')}`);
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
