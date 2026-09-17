import { formatDateWords, formatInr } from './format';

/** E.164: "+" then 7–15 digits, no leading zero. */
export const E164_RE = /^\+[1-9]\d{6,14}$/;
export const isE164 = (s: string) => E164_RE.test(s);

/** Normalise what people type into E.164: strips spaces/dashes/brackets, "00" → "+", bare 10-digit Indian numbers → +91. */
export function normalisePhone(input: string): string | null {
  let s = input.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^[6-9]\d{9}$/.test(s)) s = `+91${s}`;
  if (/^91[6-9]\d{9}$/.test(s)) s = `+${s}`;
  return isE164(s) ? s : null;
}

/** "+91••••••1234" – never show a full number in the UI or logs. */
export const maskPhone = (e164: string) => `${e164.slice(0, 3)}${'•'.repeat(Math.max(0, e164.length - 7))}${e164.slice(-4)}`;

export const SUBSCRIBER_STATUSES = ['active', 'opted_out', 'invalid'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];
export const OPT_IN_SOURCES = ['in_store', 'website', 'whatsapp_join', 'import', 'manual', 'other'] as const;
export type OptInSource = (typeof OPT_IN_SOURCES)[number];

export const INTEGRATION_CHANNELS = ['instagram', 'whatsapp'] as const;
export type IntegrationChannel = (typeof INTEGRATION_CHANNELS)[number];
export const INTEGRATION_STATUSES = ['not_configured', 'connected', 'error'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface WhatsAppTemplateSettings { templateName: string; templateLanguage: string; includeExtrasParam: boolean }
export const DEFAULT_WHATSAPP_TEMPLATE: WhatsAppTemplateSettings = { templateName: 'daily_gold_rate', templateLanguage: 'en', includeExtrasParam: false };

export interface RateValues { date: string; k24: number | string; k22: number | string; k18: number | string; extraPurities?: { label: string; value: number | string }[] }

/**
 * Body parameters for the approved daily-rate template, in order: {{1}} date, {{2}} 24K, {{3}} 22K, {{4}} 18K, [{{5}} extras].
 * Values are the exact admin-entered digits (formatInr never rounds). Extras text uses "–" when there are none so the template still sends.
 */
export function buildWhatsAppBodyParams(rate: RateValues, includeExtras: boolean): string[] {
  const params = [formatDateWords(rate.date), formatInr(rate.k24), formatInr(rate.k22), formatInr(rate.k18)];
  if (includeExtras) {
    const extras = (rate.extraPurities ?? []).map((p) => `${p.label} ${formatInr(p.value)}/g`).join(', ');
    params.push(extras || '–');
  }
  // WhatsApp rejects newlines / tabs / 4+ spaces inside parameters
  return params.map((p) => p.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   '));
}

/** Keyword handling for inbound WhatsApp / Instagram messages. */
export type InboundKeyword = 'join' | 'stop' | 'rate' | null;
export function classifyKeyword(text: string | undefined | null): InboundKeyword {
  const t = (text ?? '').trim().toLowerCase().replace(/[!.\s]+$/g, '');
  if (['join', 'subscribe', 'start', 'yes'].includes(t)) return 'join';
  if (['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'].includes(t)) return 'stop';
  if (/^(rate|rates|gold rate|rate today|today'?s rate|gold)$/.test(t)) return 'rate';
  return null;
}
