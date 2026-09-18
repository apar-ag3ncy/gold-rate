import { Router } from 'express';
import { z } from 'zod';
import { dateParamSchema } from '@chheda/shared';
import { AuditLog } from '../models';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';

const query = z.object({
  user: z.string().trim().max(120).optional(),
  action: z.string().trim().max(60).optional(),
  entity: z.string().trim().max(40).optional(),
  from: dateParamSchema.optional(), to: dateParamSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Admin-only audit trail with filters + pagination. Redacts anything that looks like a secret in before/after. */
export function auditRouter() {
  const r = Router();
  r.use(requireRole('admin'));
  r.get('/', async (req, res) => {
    const q = parse(query, req.query);
    const f: Record<string, unknown> = {};
    if (q.user) f.userEmail = { $regex: q.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (q.action) f.action = q.action;
    if (q.entity) f.entity = q.entity;
    if (q.from || q.to) f.createdAt = { ...(q.from && { $gte: new Date(`${q.from}T00:00:00+05:30`) }), ...(q.to && { $lte: new Date(`${q.to}T23:59:59.999+05:30`) }) };
    const [total, items, actions] = await Promise.all([
      AuditLog.countDocuments(f),
      AuditLog.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      AuditLog.distinct('action'),
    ]);
    res.json({ total, page: q.page, limit: q.limit, actions: actions.sort(), items: items.map((a) => ({ id: String(a._id), at: a.createdAt, userEmail: a.userEmail, action: a.action, entity: a.entity, entityId: a.entityId, ip: a.ip, before: redact(a.before), after: redact(a.after) })) });
  });
  return r;
}

function redact(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, /token|secret|password|hash/i.test(k) ? '[redacted]' : redact(val)]));
}
