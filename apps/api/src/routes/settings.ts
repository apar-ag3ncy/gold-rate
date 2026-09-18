import { Router } from 'express';
import { z } from 'zod';
import { captionTemplateSchema, DEFAULT_CAPTION_TEMPLATE, maskPhone, normalisePhone } from '@chheda/shared';
import { encrypt } from '../lib/crypto';
import { getSettings } from '../models';
import { audit } from '../lib/audit';
import { requireAuth, requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { unprocessable } from '../lib/errors';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
const updateSchema = z.object({
  automationOn: z.boolean().optional(),
  sendTime: hhmm.optional(),
  cutoffTime: hhmm.optional(),
  priceMin: z.number().positive().optional(),
  priceMax: z.number().positive().optional(),
  maxDailyChangePct: z.number().min(0.5).max(50).optional(),
  captionTemplate: captionTemplateSchema.optional(),
  manualReminderMinutes: z.number().int().min(5).max(240).optional(),
  adminAlerts: z.object({
    emails: z.array(z.string().trim().email('Invalid email')).max(10).optional(),
    /** full list of numbers, replaces the stored list (masked values from GET are accepted and keep the stored number) */
    whatsappNumbers: z.array(z.string().trim().min(5).max(20)).max(10).optional(),
    templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'lowercase letters, digits and underscores only').optional(),
    templateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'e.g. en or en_US').optional(),
  }).strict().optional(),
  whatsapp: z.object({
    templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'lowercase letters, digits and underscores only').optional(),
    templateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'e.g. en or en_US').optional(),
    includeExtrasParam: z.boolean().optional(),
  }).strict().optional(),
  channels: z.object({
    igFeed: z.boolean(), igStory: z.boolean(), waCustomers: z.boolean(), staffShare: z.boolean(), rateKeywordReply: z.boolean(),
  }).partial().optional(),
}).strict();

const view = (s: any) => ({
  automationOn: s.automationOn, sendTime: s.sendTime, cutoffTime: s.cutoffTime, timezone: s.timezone,
  priceMin: s.priceMin, priceMax: s.priceMax, maxDailyChangePct: s.maxDailyChangePct, channels: s.channels,
  captionTemplate: s.captionTemplate ?? DEFAULT_CAPTION_TEMPLATE, defaultCaptionTemplate: DEFAULT_CAPTION_TEMPLATE,
  whatsapp: { templateName: s.whatsapp?.templateName, templateLanguage: s.whatsapp?.templateLanguage, includeExtrasParam: s.whatsapp?.includeExtrasParam },
  manualReminderMinutes: s.manualReminderMinutes ?? 30,
  adminAlerts: { emails: s.adminAlerts?.emails ?? [], whatsappNumbers: (s.adminAlerts?.whatsappNumbers ?? []).map((n: any) => n.masked), templateName: s.adminAlerts?.templateName, templateLanguage: s.adminAlerts?.templateLanguage },
});

export function settingsRouter() {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (_req, res) => res.json({ settings: view(await getSettings()) }));
  r.put('/', requireRole('admin'), async (req, res) => {
    const upd = parse(updateSchema, req.body);
    const s = await getSettings();
    const before = view(s);
    const { channels, whatsapp, adminAlerts, ...rest } = upd;
    s.set(rest);
    if (channels) for (const [k, v] of Object.entries(channels)) s.set(`channels.${k}`, v);
    if (whatsapp) for (const [k, v] of Object.entries(whatsapp)) if (v !== undefined) s.set(`whatsapp.${k}`, v);
    if (adminAlerts) {
      const { whatsappNumbers, ...a } = adminAlerts;
      for (const [k, v] of Object.entries(a)) if (v !== undefined) s.set(`adminAlerts.${k}`, v);
      if (whatsappNumbers) {
        const stored: { enc: string; masked: string }[] = (s.adminAlerts?.whatsappNumbers ?? []) as any;
        const next: { enc: string; masked: string }[] = [];
        for (const raw of whatsappNumbers) {
          const keep = stored.find((n) => n.masked === raw);          // masked value echoed back from GET → keep as is
          if (keep) { next.push(keep); continue; }
          const e164 = normalisePhone(raw);
          if (!e164) throw unprocessable('Admin WhatsApp number must be in international format, e.g. +919876543210', { fields: { 'adminAlerts.whatsappNumbers': raw } });
          next.push({ enc: encrypt(e164), masked: maskPhone(e164) });
        }
        s.set('adminAlerts.whatsappNumbers', next);
      }
    }
    if (s.cutoffTime <= s.sendTime) throw unprocessable('Cut-off time must be later than the send time', { fields: { cutoffTime: 'Must be after send time' } });
    if (s.priceMin >= s.priceMax) throw unprocessable('Minimum price must be lower than maximum price', { fields: { priceMin: 'Must be below max' } });
    await s.save();
    await audit(req, 'settings_update', 'settings', 'main', before, view(s));
    res.json({ settings: view(s) });
  });
  return r;
}
