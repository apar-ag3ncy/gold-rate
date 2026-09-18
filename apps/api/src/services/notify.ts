import { ALERT_NOTIFY_WINDOW_MIN } from '@chheda/shared';
import type { Config } from '../config';
import { decrypt } from '../lib/crypto';
import { logger } from '../lib/logger';
import { Alert, getSettings } from '../models';
import { MetaClient, type FetchLike } from './meta/client';
import { getIntegrationCreds } from './integrations';

export interface Mail { to: string; subject: string; text: string; html?: string }
export type MailTransport = (mail: Mail & { from: string }) => Promise<void>;
let mailTransport: MailTransport | null = null;
export function setMailTransport(t: MailTransport | null) { mailTransport = t; }

async function defaultMailTransport(cfg: Config): Promise<MailTransport | null> {
  if (!cfg.SMTP_HOST) return null;
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure: cfg.SMTP_SECURE, auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfp(cfg) } : undefined });
  return async (m) => { await transporter.sendMail(m); };
}
const cfp = (cfg: Config) => cfg.SMTP_PASS ?? '';

const TITLES: Record<string, string> = {
  rate_missing: 'Gold rate NOT sent – rate missing', send_failed: 'Gold rate sending failed', partial_send: 'Gold rate sent on some channels only',
  token_expiring: 'Meta token needs attention', manual_pending: 'Staff share still pending', health_check: 'Pre-send check found problems', day_skipped: 'No gold rate sent today',
};

/**
 * Fan an alert out to admins: email (SMTP from env) + WhatsApp utility template (numbers from settings).
 * De-dup: the same type for the same date is notified at most once per ALERT_NOTIFY_WINDOW_MIN.
 */
export async function notifyAdmins(cfg: Config, alertId: string, opts: { fetchFn?: FetchLike; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const alert = await Alert.findById(alertId);
  if (!alert) return { sent: false, reason: 'alert not found' as const };
  const since = new Date(now.getTime() - ALERT_NOTIFY_WINDOW_MIN * 60_000);
  const recent = await Alert.findOne({ _id: { $ne: alert._id }, type: alert.type, date: alert.date ?? null, notifiedAt: { $gte: since } }).lean();
  if (recent) {
    await alert.updateOne({ $push: { notifications: { channel: 'dedupe', status: 'skipped', at: now, error: `same ${alert.type} for ${alert.date} notified at ${recent.notifiedAt?.toISOString()}` } } });
    return { sent: false, reason: 'deduplicated' as const };
  }
  const s = await getSettings();
  const title = TITLES[alert.type] ?? `Alert: ${alert.type}`;
  const link = `${cfg.WEB_PUBLIC_URL}/alerts`;
  const notifications: { channel: string; to: string; status: string; error?: string; at: Date }[] = [];

  // ---- email ----
  const emails: string[] = s.adminAlerts?.emails ?? [];
  const mail = mailTransport ?? await defaultMailTransport(cfg);
  for (const to of emails) {
    if (!mail) { notifications.push({ channel: 'email', to, status: 'skipped', error: 'SMTP_HOST not configured', at: now }); continue; }
    try {
      await mail({ from: cfg.SMTP_FROM ?? 'Chheda Gold Rate <no-reply@localhost>', to, subject: `[Chheda Gold Rate] ${title}${alert.date ? ` (${alert.date})` : ''}`,
        text: `${alert.message}\n\nOpen the dashboard: ${link}`, html: `<p>${escapeHtml(alert.message)}</p><p><a href="${link}">Open the dashboard</a></p>` });
      notifications.push({ channel: 'email', to, status: 'sent', at: now });
    } catch (e: any) { notifications.push({ channel: 'email', to, status: 'failed', error: e?.message, at: now }); logger.warn({ err: e?.message }, 'alert email failed'); }
  }

  // ---- WhatsApp utility template to admin numbers ----
  const numbers = ((s.adminAlerts?.whatsappNumbers ?? []) as any[]).filter((n) => n?.enc && n?.masked) as { enc: string; masked: string }[];
  const tplName = s.adminAlerts?.templateName ?? 'admin_alert', tplLang = s.adminAlerts?.templateLanguage ?? 'en';
  if (numbers.length) {
    const creds = cfg.DRY_RUN ? null : await getIntegrationCreds('whatsapp');
    const client = new MetaClient(cfg, opts.fetchFn);
    for (const n of numbers) {
      try {
        if (cfg.DRY_RUN) { logger.info({ to: n.masked, title }, 'DRY_RUN admin WhatsApp alert'); notifications.push({ channel: 'whatsapp', to: n.masked, status: 'dry_run', at: now }); continue; }
        if (!creds?.ok) throw new Error(creds?.reason ?? 'WhatsApp not connected');
        const to = decrypt(n.enc).replace(/^\+/, '');
        await client.post(`${creds.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp', to, type: 'template',
          template: { name: tplName, language: { code: tplLang },
            components: [{ type: 'body', parameters: [{ type: 'text', text: clean(title) }, { type: 'text', text: clean(alert.message) }] }] },
        }, creds.token);
        notifications.push({ channel: 'whatsapp', to: n.masked, status: 'sent', at: now });
      } catch (e: any) { notifications.push({ channel: 'whatsapp', to: n.masked, status: 'failed', error: e?.message, at: now }); logger.warn({ err: e?.message }, 'admin WhatsApp alert failed'); }
    }
  }

  alert.set({ notifiedAt: now });
  alert.notifications.push(...notifications as any);
  await alert.save();
  return { sent: true as const, notifications };
}

const clean = (t: string) => t.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000);
const escapeHtml = (t: string) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
