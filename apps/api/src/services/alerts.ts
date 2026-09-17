import type { AlertSeverity, AlertType } from '@chheda/shared';
import { Alert } from '../models';
import { logger } from '../lib/logger';

export interface RaiseAlert { type: AlertType; message: string; date?: string; severity?: AlertSeverity; dedupeKey?: string; meta?: unknown }

/** Creates an alert once per dedupeKey. Admin notification channels (email / WhatsApp utility template) are wired in Phase 4. */
export async function raiseAlert(a: RaiseAlert) {
  try {
    const doc = await Alert.create({ ...a, severity: a.severity ?? 'warning' });
    logger.warn({ alert: { type: a.type, date: a.date, message: a.message } }, 'ALERT raised');
    return { created: true as const, alert: doc };
  } catch (e: any) {
    if (e?.code === 11000) return { created: false as const, alert: await Alert.findOne({ dedupeKey: a.dedupeKey }) };
    throw e;
  }
}

export function alertToDTO(a: any) {
  return { id: String(a._id), type: a.type, severity: a.severity, message: a.message, date: a.date, status: a.status, ackBy: a.ackBy, ackAt: a.ackAt, createdAt: a.createdAt };
}
