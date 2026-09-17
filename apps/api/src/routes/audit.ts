import { Router } from 'express';
import { z } from 'zod';
import { AuditLog } from '../models';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';

export function auditRouter() {
  const r = Router();
  r.get('/', requireRole('admin'), async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const items = await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ items });
  });
  return r;
}
