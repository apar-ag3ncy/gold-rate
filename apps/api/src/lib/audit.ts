import type { Request } from 'express';
import { AuditLog } from '../models';

export function audit(req: Request, action: string, entity: string, entityId: string, before?: unknown, after?: unknown) {
  return AuditLog.create({
    userId: req.user?.id, userEmail: req.user?.email, action, entity, entityId,
    before, after, ip: req.ip,
  });
}
