import { Router } from 'express';
import { z } from 'zod';
import { dateParamSchema, rateInputSchema, istDate, addDays } from '@chheda/shared';
import { Rate } from '../models';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { approveRate, cancelRate, checkRate, saveRate, toDTO } from '../services/rates';

const listQuery = z.object({
  from: dateParamSchema.optional(),
  to: dateParamSchema.optional(),
  status: z.enum(['draft', 'approved', 'sent', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(366).default(60),
});

export function ratesRouter() {
  const r = Router();
  r.use(requireAuth);

  // Today / tomorrow summary for the dashboard
  r.get('/summary', async (_req, res) => {
    const today = istDate();
    const tomorrow = addDays(today, 1);
    const [t, tm] = await Promise.all([Rate.findOne({ date: today }), Rate.findOne({ date: tomorrow })]);
    res.json({ today, tomorrow, todayRate: t ? toDTO(t) : null, tomorrowRate: tm ? toDTO(tm) : null });
  });

  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const filter: Record<string, unknown> = {};
    if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
    if (q.status) filter.status = q.status;
    const items = await Rate.find(filter).sort({ date: -1 }).limit(q.limit);
    res.json({ items: items.map(toDTO) });
  });

  r.get('/:date', async (req, res) => {
    const date = parse(dateParamSchema, req.params.date);
    const rate = await Rate.findOne({ date });
    if (!rate) throw notFound(`No rate saved for ${date}`);
    res.json({ rate: toDTO(rate) });
  });

  // Dry validation (no save) – used by the form for live feedback
  r.post('/:date/check', requireRole('admin'), async (req, res) => {
    const date = parse(dateParamSchema, req.params.date);
    const input = parse(rateInputSchema, req.body);
    res.json(await checkRate(date, input));
  });

  r.put('/:date', requireRole('admin'), async (req, res) => {
    const date = parse(dateParamSchema, req.params.date);
    const input = parse(rateInputSchema, req.body);
    const { rate, before, warnings } = await saveRate(date, input, req.user!.email);
    await audit(req, before ? 'rate_update' : 'rate_create', 'rate', date, before, { k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities });
    res.json({ rate: toDTO(rate), warnings });
  });

  r.post('/:date/approve', requireRole('admin'), async (req, res) => {
    const date = parse(dateParamSchema, req.params.date);
    const rate = await approveRate(date, req.user!.email);
    await audit(req, 'rate_approve', 'rate', date, { status: 'draft' }, { status: 'approved' });
    res.json({ rate: toDTO(rate) });
  });

  r.post('/:date/cancel', requireRole('admin'), async (req, res) => {
    const date = parse(dateParamSchema, req.params.date);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(300) }), req.body);
    const rate = await cancelRate(date, req.user!.email, reason);
    await audit(req, 'rate_cancel', 'rate', date, undefined, { status: 'cancelled', reason });
    res.json({ rate: toDTO(rate) });
  });

  return r;
}
