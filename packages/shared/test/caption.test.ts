import { describe, it, expect } from 'vitest';
import {
  buildCaption, validateCaptionTemplate, captionTemplateSchema, DEFAULT_CAPTION_TEMPLATE,
  formatInr, formatPerGram, formatDateWords, groupIndian, deliveryIdempotencyKey, CUSTOMER_CHANNELS,
} from '../src';

describe('currency formatting – exact digits, never rounded', () => {
  it('formats Indian grouping', () => {
    expect(formatInr(11250)).toBe('₹11,250');
    expect(formatInr(1250)).toBe('₹1,250');
    expect(formatInr(999)).toBe('₹999');
    expect(formatInr(1234567)).toBe('₹12,34,567');
    expect(groupIndian('123456789')).toBe('12,34,56,789');
  });
  it('keeps decimals exactly as entered', () => {
    expect(formatInr(10305.5)).toBe('₹10,305.5');
    expect(formatInr('10305.50')).toBe('₹10,305.50');
    expect(formatInr(8437.25)).toBe('₹8,437.25');
    expect(formatPerGram(10305.5)).toBe('₹10,305.5 /g');
  });
  it('refuses anything that is not a plain positive number', () => {
    expect(() => formatInr('1,000')).toThrow();
    expect(() => formatInr(-5)).toThrow();
  });
});

describe('date in words', () => {
  it('renders weekday, day, month, year', () => {
    expect(formatDateWords('2026-09-17')).toBe('Thu, 17 Sept 2026');
    expect(formatDateWords('2026-09-18')).toBe('Fri, 18 Sept 2026');
    expect(formatDateWords('2027-01-01')).toBe('Fri, 1 Jan 2027');
  });
});

describe('caption template validation', () => {
  it('accepts the default template', () => {
    expect(validateCaptionTemplate(DEFAULT_CAPTION_TEMPLATE)).toEqual({ ok: true, errors: [] });
    expect(captionTemplateSchema.safeParse(DEFAULT_CAPTION_TEMPLATE).success).toBe(true);
  });
  it('rejects unknown placeholders', () => {
    const r = validateCaptionTemplate('24K {k24} {k22} {k18} {silver}');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Unknown placeholder \{silver\}/);
    expect(captionTemplateSchema.safeParse('{k24} {k22} {k18} {foo}').success).toBe(false);
  });
  it('requires the three main rates and rejects empty templates', () => {
    expect(validateCaptionTemplate('Gold rate {date} {k24}').errors.join()).toMatch(/\{k22\}/);
    expect(validateCaptionTemplate('   ').ok).toBe(false);
  });
});

describe('caption building', () => {
  const rate = { date: '2026-09-18', k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [{ label: '14K', value: 6560 }] };
  it('fills every placeholder with exact values', () => {
    const c = buildCaption(DEFAULT_CAPTION_TEMPLATE, rate);
    expect(c).toContain('Gold Rate – Fri, 18 Sept 2026');
    expect(c).toContain('24K: ₹11,250 /g');
    expect(c).toContain('22K: ₹10,305.5 /g');
    expect(c).toContain('18K: ₹8,437 /g');
    expect(c).toContain('14K: ₹6,560 /g');
    expect(c).toContain('Excl. GST & making charges');
    expect(c).not.toMatch(/\{[a-z0-9]+\}/);
  });
  it('drops the extras line entirely when there are no extras', () => {
    const c = buildCaption(DEFAULT_CAPTION_TEMPLATE, { ...rate, extraPurities: [] });
    expect(c).not.toContain('{extras}');
    expect(c).toContain('18K: ₹8,437 /g\n\n*Rates per gram');
  });
  it('works with a custom template', () => {
    expect(buildCaption('Today {date}: 24K {k24}, 22K {k22}, 18K {k18}.', { ...rate, extraPurities: [] }))
      .toBe('Today Fri, 18 Sept 2026: 24K ₹11,250, 22K ₹10,305.5, 18K ₹8,437.');
  });
});

describe('delivery idempotency keys', () => {
  it('real sends are one-per-date-per-channel; tests carry a nonce', () => {
    expect(deliveryIdempotencyKey('2026-09-18', 'ig_feed', 'cron')).toBe('2026-09-18:ig_feed');
    expect(deliveryIdempotencyKey('2026-09-18', 'ig_feed', 'send_now')).toBe('2026-09-18:ig_feed');
    expect(deliveryIdempotencyKey('2026-09-18', 'wa_admin', 'test', 'abc')).toBe('2026-09-18:wa_admin:test:abc');
    expect(() => deliveryIdempotencyKey('2026-09-18', 'wa_admin', 'test')).toThrow();
    expect(CUSTOMER_CHANNELS).not.toContain('wa_admin');
  });
});
