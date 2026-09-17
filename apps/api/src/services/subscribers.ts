import { maskPhone, normalisePhone, OPT_IN_SOURCES, type OptInSource } from '@chheda/shared';
import { encrypt, lookupHash } from '../lib/crypto';
import { logger } from '../lib/logger';
import { Subscriber } from '../models';
import { unprocessable } from '../lib/errors';

export function subscriberToDTO(s: any) {
  return { id: String(s._id), phoneMasked: s.phoneMasked, name: s.name, status: s.status, optInSource: s.optInSource, optInAt: s.optInAt, optOutAt: s.optOutAt,
    lastDeliveryStatus: s.lastDeliveryStatus, lastDeliveryAt: s.lastDeliveryAt, lastError: s.lastError, addedBy: s.addedBy, createdAt: s.createdAt };
}

export async function subscriberCounts() {
  const rows = await Subscriber.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  const c = { active: 0, opted_out: 0, invalid: 0, total: 0 };
  for (const r of rows) { (c as any)[r._id] = r.n; c.total += r.n; }
  return c;
}

/** Add (or re-activate) a subscriber. Returns { created, subscriber }. The plain number is never logged. */
export async function optIn(phoneInput: string, source: OptInSource, by?: string, name?: string) {
  const phone = normalisePhone(phoneInput);
  if (!phone) throw unprocessable('Enter a valid phone number in international format, e.g. +919876543210', { fields: { phone: 'Invalid number' } });
  const phoneHash = lookupHash(phone);
  const existing = await Subscriber.findOne({ phoneHash });
  if (existing) {
    if (existing.status === 'active') return { created: false, reactivated: false, subscriber: existing };
    existing.set({ status: 'active', optInAt: new Date(), optInSource: source, optOutAt: undefined, lastError: undefined, ...(name && { name }) });
    await existing.save();
    return { created: false, reactivated: true, subscriber: existing };
  }
  const subscriber = await Subscriber.create({ phoneEnc: encrypt(phone), phoneHash, phoneMasked: maskPhone(phone), name, optInAt: new Date(), optInSource: source, status: 'active', addedBy: by });
  logger.info({ phone: subscriber.phoneMasked, source }, 'subscriber opted in');
  return { created: true, reactivated: false, subscriber };
}

export async function optOut(phoneInput: string) {
  const phone = normalisePhone(phoneInput);
  if (!phone) return null;
  const s = await Subscriber.findOne({ phoneHash: lookupHash(phone) });
  if (!s) return null;
  if (s.status !== 'opted_out') { s.set({ status: 'opted_out', optOutAt: new Date() }); await s.save(); logger.info({ phone: s.phoneMasked }, 'subscriber opted out'); }
  return s;
}

export async function findByPhone(phoneInput: string) {
  const phone = normalisePhone(phoneInput);
  return phone ? Subscriber.findOne({ phoneHash: lookupHash(phone) }) : null;
}

/** Minimal CSV: header row with phone, optInSource[, name]; commas or semicolons; quotes optional. */
export function parseCsv(text: string): { rows: Record<string, string>[]; error?: string } {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: 'CSV needs a header row (phone,optInSource[,name]) and at least one data row.' };
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const idx = { phone: header.findIndex((h) => h === 'phone' || h === 'number' || h === 'mobile'), source: header.findIndex((h) => h === 'optinsource' || h === 'source'), name: header.indexOf('name') };
  if (idx.phone < 0 || idx.source < 0) return { rows: [], error: 'Header must include "phone" and "optInSource" columns.' };
  return { rows: lines.slice(1).map((l) => { const c = split(l); return { phone: c[idx.phone] ?? '', optInSource: c[idx.source] ?? '', name: idx.name >= 0 ? c[idx.name] ?? '' : '' }; }) };
}

export async function importCsv(text: string, by: string) {
  const { rows, error } = parseCsv(text);
  if (error) throw unprocessable(error);
  if (rows.length > 5000) throw unprocessable('Import at most 5,000 rows at a time.');
  const result = { added: 0, reactivated: 0, alreadyActive: 0, errors: [] as { row: number; problem: string }[] };
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const source = r.optInSource.trim().toLowerCase().replace(/[\s-]+/g, '_') as OptInSource;
    if (!(OPT_IN_SOURCES as readonly string[]).includes(source)) { result.errors.push({ row: line, problem: `optInSource must be one of ${OPT_IN_SOURCES.join(', ')}` }); continue; }
    if (!normalisePhone(r.phone)) { result.errors.push({ row: line, problem: 'invalid phone number (use E.164, e.g. +919876543210)' }); continue; }
    const o = await optIn(r.phone, source, by, r.name || undefined);
    if (o.created) result.added++; else if (o.reactivated) result.reactivated++; else result.alreadyActive++;
  }
  return result;
}
