import { describe, it, expect } from 'vitest';
import { buildWhatsAppBodyParams, classifyKeyword, isE164, maskPhone, normalisePhone, retryWithBackoff } from '../src';

describe('phone numbers', () => {
  it('normalises to E.164 and rejects junk', () => {
    expect(normalisePhone('98765 43210')).toBe('+919876543210');
    expect(normalisePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalisePhone('0091 9876543210')).toBe('+919876543210');
    expect(normalisePhone('+1 (415) 555-2671')).toBe('+14155552671');
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('+0123456789')).toBeNull();
    expect(isE164('+919876543210')).toBe(true);
  });
  it('masks all but country code and last 4', () => {
    expect(maskPhone('+919876543210')).toBe('+91••••••3210');
    expect(maskPhone('+919876543210')).not.toContain('98765');
  });
});

describe('WhatsApp template params', () => {
  const rate = { date: '2026-09-18', k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [{ label: '14K', value: 6560 }] };
  it('sends exact values in order', () => {
    expect(buildWhatsAppBodyParams(rate, false)).toEqual(['Fri, 18 Sept 2026', '₹11,250', '₹10,305.5', '₹8,437']);
    expect(buildWhatsAppBodyParams(rate, true)[4]).toBe('14K ₹6,560/g');
    expect(buildWhatsAppBodyParams({ ...rate, extraPurities: [] }, true)[4]).toBe('–');
  });
  it('strips newlines that WhatsApp rejects', () => {
    expect(buildWhatsAppBodyParams({ ...rate, extraPurities: [{ label: 'A\nB', value: 5000 }] }, true)[4]).toBe('A B ₹5,000/g');
  });
});

describe('inbound keywords', () => {
  it('classifies JOIN / STOP / RATE case-insensitively', () => {
    expect(classifyKeyword('JOIN')).toBe('join');
    expect(classifyKeyword(' stop! ')).toBe('stop');
    expect(classifyKeyword('Rate today')).toBe('rate');
    expect(classifyKeyword('hello')).toBeNull();
  });
});

describe('retryWithBackoff stops on permanent errors', () => {
  it('does not retry when shouldRetry says no', async () => {
    let calls = 0;
    const r = await retryWithBackoff(async () => { calls++; throw Object.assign(new Error('perm'), { retryable: false }); }, { sleep: async () => {}, shouldRetry: (e: any) => e.retryable !== false });
    expect(calls).toBe(1);
    expect(r).toMatchObject({ ok: false, attempts: 1 });
  });
});
