import { z } from 'zod';
import { formatDateWords, formatInr } from './format';

/** Values a caption can show. Only these placeholders are allowed in a template. */
export const CAPTION_PLACEHOLDERS = ['date', 'k24', 'k22', 'k18', 'extras'] as const;
export type CaptionPlaceholder = (typeof CAPTION_PLACEHOLDERS)[number];
export const CAPTION_MAX_LENGTH = 2000; // Instagram caption limit is 2,200 chars; keep headroom for hashtags

export const DEFAULT_CAPTION_TEMPLATE = `✨ Chheda Jewellers ✨
Gold Rate – {date}

24K: {k24} /g
22K: {k22} /g
18K: {k18} /g
{extras}

*Rates per gram · Excl. GST & making charges.*`;

export interface CaptionRate {
  date: string;
  k24: number | string;
  k22: number | string;
  k18: number | string;
  extraPurities?: { label: string; value: number | string }[];
}

export interface CaptionTemplateCheck { ok: boolean; errors: string[] }

/** Validates a template. Blocks unknown placeholders – it never rewrites the template. */
export function validateCaptionTemplate(template: string): CaptionTemplateCheck {
  const errors: string[] = [];
  if (template.trim().length === 0) errors.push('Caption template cannot be empty.');
  if (template.length > CAPTION_MAX_LENGTH) errors.push(`Caption template is too long (max ${CAPTION_MAX_LENGTH} characters).`);
  const found = new Set<string>();
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1].trim();
    if (!(CAPTION_PLACEHOLDERS as readonly string[]).includes(name)) {
      errors.push(`Unknown placeholder {${m[1]}}. Allowed: ${CAPTION_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`);
    } else found.add(name);
  }
  for (const req of ['k24', 'k22', 'k18'] as const) {
    if (!found.has(req)) errors.push(`Template must include {${req}} so the ${req.slice(1)}K rate is always posted.`);
  }
  return { ok: errors.length === 0, errors };
}

export const captionTemplateSchema = z.string().superRefine((t, ctx) => {
  for (const e of validateCaptionTemplate(t).errors) ctx.addIssue({ code: 'custom', message: e });
});

/** Fills placeholders with the exact stored values. Unknown placeholders are left as-is (validation blocks them on save). */
export function buildCaption(template: string, rate: CaptionRate): string {
  const extras = (rate.extraPurities ?? []).map((p) => `${p.label}: ${formatInr(p.value)} /g`).join('\n');
  const values: Record<CaptionPlaceholder, string> = {
    date: formatDateWords(rate.date),
    k24: formatInr(rate.k24),
    k22: formatInr(rate.k22),
    k18: formatInr(rate.k18),
    extras,
  };
  let out = template;
  if (!extras) out = out.replace(/[ \t]*\{extras\}[ \t]*\n?/g, ''); // drop the whole line when there are no extras
  out = out.replace(/\{(date|k24|k22|k18|extras)\}/g, (_m, k: CaptionPlaceholder) => values[k]);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
