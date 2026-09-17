import { z } from 'zod';
import { isValidDateString } from './dates';

/**
 * RULE: validation only BLOCKS. It never rounds, derives or modifies a value.
 * Whatever the admin typed is exactly what gets stored and published.
 */

const money = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const s = typeof v === 'number' ? String(v) : v.trim();
    if (s === '') { ctx.addIssue({ code: 'custom', message: 'Required' }); return z.NEVER; }
    if (!/^\d+(\.\d{1,2})?$/.test(s)) { ctx.addIssue({ code: 'custom', message: 'Enter a number with at most 2 decimals (no commas or symbols)' }); return z.NEVER; }
    const n = Number(s);
    if (!(n > 0)) { ctx.addIssue({ code: 'custom', message: 'Must be greater than 0' }); return z.NEVER; }
    return n;
  });

export const extraPuritySchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(20, 'Max 20 characters'),
  value: money,
});

export const rateInputSchema = z.object({
  k24: money,
  k22: money,
  k18: money,
  extraPurities: z.array(extraPuritySchema).max(10, 'Max 10 extra purities').default([]),
  overrideReason: z.string().trim().max(300).optional().default(''),
});
export type RateInput = z.infer<typeof rateInputSchema>;

export const dateParamSchema = z.string().refine(isValidDateString, 'Date must be YYYY-MM-DD');

export interface RateRules {
  priceMin: number;            // per gram, applies to every purity
  priceMax: number;
  maxDailyChangePct: number;   // vs previous approved/sent 24K rate
}
export const DEFAULT_RULES: RateRules = { priceMin: 1000, priceMax: 50000, maxDailyChangePct: 5 };

export interface BusinessCheckContext {
  date: string;
  today: string;
  previous?: { date: string; k24: number } | null;
  rules?: RateRules;
}
export interface CheckResult { ok: boolean; errors: string[]; warnings: string[] }

const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function checkRateBusinessRules(input: RateInput, ctx: BusinessCheckContext): CheckResult {
  const rules = ctx.rules ?? DEFAULT_RULES;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (ctx.date < ctx.today) errors.push(`Cannot save a rate for a past date (${ctx.date}).`);

  const all: [string, number][] = [
    ['24K', input.k24], ['22K', input.k22], ['18K', input.k18],
    ...input.extraPurities.map((p) => [p.label, p.value] as [string, number]),
  ];
  for (const [label, v] of all) {
    if (v < rules.priceMin || v > rules.priceMax) {
      errors.push(`${label} rate ₹${inr(v)}/g is outside the allowed range ₹${inr(rules.priceMin)}–₹${inr(rules.priceMax)}/g. Check for a missing or extra digit.`);
    }
  }

  if (!(input.k24 > input.k22)) errors.push('24K rate must be higher than 22K rate.');
  if (!(input.k22 > input.k18)) errors.push('22K rate must be higher than 18K rate.');

  const labels = input.extraPurities.map((p) => p.label.toLowerCase());
  if (new Set(labels).size !== labels.length) errors.push('Extra purity labels must be unique.');
  if (labels.some((l) => ['24k', '22k', '18k'].includes(l))) errors.push('Extra purities cannot reuse 24K / 22K / 18K.');

  if (ctx.previous && ctx.previous.k24 > 0) {
    const pct = ((input.k24 - ctx.previous.k24) / ctx.previous.k24) * 100;
    if (Math.abs(pct) > rules.maxDailyChangePct) {
      const msg = `24K changed ${pct > 0 ? '+' : ''}${pct.toFixed(2)}% vs ${ctx.previous.date} (₹${inr(ctx.previous.k24)}/g). Limit is ±${rules.maxDailyChangePct}%.`;
      if ((input.overrideReason ?? '').length >= 5) warnings.push(`${msg} Override reason: "${input.overrideReason}"`);
      else errors.push(`${msg} If this is correct, add an override reason (min 5 characters).`);
    } else if (pct === 0) {
      warnings.push(`24K rate is the same as ${ctx.previous.date}. Please confirm it is updated.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
