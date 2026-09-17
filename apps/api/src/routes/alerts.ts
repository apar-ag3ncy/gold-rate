import { Router } from 'express';
import { z } from 'zod';
import { Alert } from '../models';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { alertToDTO } from '../services/alerts';

const listQuery = z.object({ status: z.enum(['open', 'acked']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export function alertsRouter() {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const items = await Alert.find(q.status ? { status: q.status } : {}).sort({ createdAt: -1 }).limit(q.limit).lean();
    res.json({ items: items.map(alertToDTO) });
  });
  r.post('/:id/ack', requireRole('admin', 'staff'), async (req, res) => {
    const id = parse(z.string().regex(/^[0-9a-f]{24}$/), req.params.id);
    const a = await Alert.findById(id);
    if (!a) throw notFound('Alert not found');
    if (a.status !== 'acked') { a.set({ status: 'acked', ackBy: req.user!.email, ackAt: new Date() }); await a.save(); await audit(req, 'alert_ack', 'alert', id); }
    res.json({ alert: alertToDTO(a) });
  });
  return r;
}
