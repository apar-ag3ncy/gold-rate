import type { AlertSeverity, AlertType } from '@chheda/shared';
import type { Config } from '../config';
import { Alert } from '../models';
import { logger } from '../lib/logger';

export interface RaiseAlert { type: AlertType; message: string; date?: string; severity?: AlertSeverity; dedupeKey?: string; meta?: unknown }

/** Set once at startup (API + worker) so every raised alert is fanned out to admins (email + WhatsApp). */
let notifier: ((alertId: string) => Promise<unknown>) | null = null;
export function setAlertNotifier(cfg: Config | null, custom?: (alertId: string) => Promise<unknown>) {
  if (custom) { notifier = custom; return; }
  if (!cfg) { notifier = null; return; }
  notifier = async (id) => { const { notifyAdmins } = await import('./notify'); return notifyAdmins(cfg, id); };
}

/** Creates an alert once per dedupeKey, then notifies admins (awaited so callers/tests see the result). */
export async function raiseAlert(a: RaiseAlert) {
  try {
    const doc = await Alert.create({ ...a, severity: a.severity ?? 'warning' });
    logger.warn({ alert: { type: a.type, date: a.date, message: a.message } }, 'ALERT raised');
    if (notifier) await notifier(String(doc._id)).catch((err) => logger.error({ err }, 'alert notification failed'));
    return { created: true as const, alert: doc };
  } catch (e: any) {
    if (e?.code === 11000) return { created: false as const, alert: await Alert.findOne({ dedupeKey: a.dedupeKey }) };
    throw e;
  }
}

export function alertToDTO(a: any) {
  return { id: String(a._id), type: a.type, severity: a.severity, message: a.message, date: a.date, status: a.status, ackBy: a.ackBy, ackAt: a.ackAt, createdAt: a.createdAt,
    notifiedAt: a.notifiedAt, notifications: (a.notifications ?? []).map((n: any) => ({ channel: n.channel, to: n.to, status: n.status, error: n.error, at: n.at })) };
}
