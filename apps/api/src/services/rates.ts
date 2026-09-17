import { checkRateBusinessRules, istDate, type RateInput } from '@chheda/shared';
import { Rate, getSettings } from '../models';
import { conflict, notFound, unprocessable } from '../lib/errors';

const snapshot = (r: any) => r && ({ k24: r.k24, k22: r.k22, k18: r.k18, extraPurities: r.extraPurities, status: r.status });

export function toDTO(r: any) {
  return {
    id: String(r._id), date: r.date, unit: r.unit,
    k24: r.k24, k22: r.k22, k18: r.k18,
    extraPurities: (r.extraPurities ?? []).map((p: any) => ({ label: p.label, value: p.value })),
    status: r.status, enteredBy: r.enteredBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt,
    overrideReason: r.overrideReason || undefined,
    validation: { errors: r.validation?.errors ?? [], warnings: r.validation?.warnings ?? [] },
    revisions: r.revisions ?? [],
    creativeUrls: r.creativeUrls?.feed ? { feed: r.creativeUrls.feed, story: r.creativeUrls.story } : undefined,
    caption: r.caption || undefined,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

async function previousRate(date: string) {
  return Rate.findOne({ date: { $lt: date }, status: { $in: ['approved', 'sent'] } }).sort({ date: -1 }).lean();
}

export async function checkRate(date: string, input: RateInput, now = new Date()) {
  const s = await getSettings();
  const prev = await previousRate(date);
  return checkRateBusinessRules(input, {
    date, today: istDate(now),
    previous: prev ? { date: prev.date, k24: prev.k24 } : null,
    rules: { priceMin: s.priceMin, priceMax: s.priceMax, maxDailyChangePct: s.maxDailyChangePct },
  });
}

/** Create or update the draft for a date. Stores values exactly as entered. */
export async function saveRate(date: string, input: RateInput, by: string, now = new Date()) {
  const existing = await Rate.findOne({ date });
  if (existing?.status === 'sent') throw conflict('This rate has already been sent and is locked.');
  const result = await checkRate(date, input, now);
  if (!result.ok) throw unprocessable('Rate not saved – please fix the problems below', { errors: result.errors, warnings: result.warnings });

  const values = { k24: input.k24, k22: input.k22, k18: input.k18, extraPurities: input.extraPurities, overrideReason: input.overrideReason || undefined };
  const before = snapshot(existing);
  const action = !existing ? 'create' : existing.status === 'approved' ? 'update_unapproved' : 'update';
  const rate = existing ?? new Rate({ date });
  rate.set({ ...values, status: 'draft', enteredBy: by, approvedBy: undefined, approvedAt: undefined, validation: { errors: [], warnings: result.warnings } });
  rate.revisions.push({ at: now, by, action, from: before, to: { ...values, status: 'draft' } });
  await rate.save();
  return { rate, before, warnings: result.warnings };
}

/** Approve. Re-runs validation so a stale draft can't be approved. Same admin may approve. */
export async function approveRate(date: string, by: string, now = new Date()) {
  const rate = await Rate.findOne({ date });
  if (!rate) throw notFound(`No rate saved for ${date}`);
  if (rate.status !== 'draft') throw conflict(`Rate is already ${rate.status}`);
  const result = await checkRate(date, { k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities as any, overrideReason: rate.overrideReason ?? '' }, now);
  if (!result.ok) throw unprocessable('Rate can no longer be approved', { errors: result.errors, warnings: result.warnings });
  rate.set({ status: 'approved', approvedBy: by, approvedAt: now, validation: { errors: [], warnings: result.warnings } });
  rate.revisions.push({ at: now, by, action: 'approve', from: { status: 'draft' }, to: { status: 'approved' } });
  await rate.save();
  return rate;
}

/** Withdraw approval / cancel a not-yet-sent rate (scheduler will then send nothing for that date). */
export async function cancelRate(date: string, by: string, reason: string, now = new Date()) {
  const rate = await Rate.findOne({ date });
  if (!rate) throw notFound(`No rate saved for ${date}`);
  if (rate.status === 'sent') throw conflict('Sent rates cannot be cancelled.');
  const from = rate.status;
  rate.status = 'cancelled';
  rate.revisions.push({ at: now, by, action: 'cancel', from: { status: from }, to: { status: 'cancelled', reason } });
  await rate.save();
  return rate;
}
