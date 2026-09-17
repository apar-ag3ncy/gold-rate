import express, { Router } from 'express';
import { z } from 'zod';
import { OPT_IN_SOURCES, SUBSCRIBER_STATUSES } from '@chheda/shared';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { Subscriber } from '../models';
import { importCsv, optIn, subscriberCounts, subscriberToDTO } from '../services/subscribers';

const listQuery = z.object({ status: z.enum(SUBSCRIBER_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
const addSchema = z.object({ phone: z.string().trim().min(5).max(20), optInSource: z.enum(OPT_IN_SOURCES), name: z.string().trim().max(80).optional() });

export function subscribersRouter() {
  const r = Router();
  r.use(requireRole('admin', 'staff'));
  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    const items = await Subscriber.find(q.status ? { status: q.status } : {}).sort({ createdAt: -1 }).limit(q.limit).lean();
    res.json({ counts: await subscriberCounts(), items: items.map(subscriberToDTO) });
  });
  r.post('/', requireRole('admin'), async (req, res) => {
    const b = parse(addSchema, req.body);
    const o = await optIn(b.phone, b.optInSource, req.user!.email, b.name);
    await audit(req, 'subscriber_add', 'subscriber', String(o.subscriber._id), undefined, { phone: o.subscriber.phoneMasked, source: b.optInSource });
    res.status(o.created ? 201 : 200).json({ created: o.created, reactivated: o.reactivated, item: subscriberToDTO(o.subscriber) });
  });
  r.post('/import', requireRole('admin'), express.json({ limit: '2mb' }), async (req, res) => {
    const { csv } = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
    const result = await importCsv(csv, req.user!.email);
    await audit(req, 'subscriber_import', 'subscriber', 'csv', undefined, { added: result.added, reactivated: result.reactivated, errors: result.errors.length });
    res.json(result);
  });
  r.delete('/:id', requireRole('admin'), async (req, res) => {
    const id = parse(z.string().regex(/^[0-9a-f]{24}$/), req.params.id);
    const s = await Subscriber.findById(id);
    if (!s) throw notFound('Subscriber not found');
    await s.deleteOne();
    await audit(req, 'subscriber_remove', 'subscriber', id, { phone: s.phoneMasked });
    res.json({ ok: true });
  });
  return r;
}
