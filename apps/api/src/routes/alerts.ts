import { Router } from 'express';
import { z } from 'zod';
import { ALERT_TYPES, dateParamSchema } from '@chheda/shared';
import { Alert } from '../models';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { alertToDTO } from '../services/alerts';

const listQuery = z.object({ status: z.enum(['open', 'acked']).optional(), type: z.enum(ALERT_TYPES).optional(), date: dateParamSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export function alertsRouter() {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.type) filter.type = q.type;
    if (q.date) filter.date = q.date;
    const items = await Alert.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean();
    res.json({ items: items.map(alertToDTO), openCount: await Alert.countDocuments({ status: 'open' }) });
  });
  r.get('/count', async (_req, res) => res.json({ open: await Alert.countDocuments({ status: 'open' }) }));
  r.post('/:id/ack', requireRole('admin', 'staff'), async (req, res) => {
    const id = parse(z.string().regex(/^[0-9a-f]{24}$/), req.params.id);
    const a = await Alert.findById(id);
    if (!a) throw notFound('Alert not found');
    if (a.status !== 'acked') { a.set({ status: 'acked', ackBy: req.user!.email, ackAt: new Date() }); await a.save(); await audit(req, 'alert_ack', 'alert', id); }
    res.json({ alert: alertToDTO(a) });
  });
  return r;
}
