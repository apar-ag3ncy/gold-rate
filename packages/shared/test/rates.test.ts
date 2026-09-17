import { describe, it, expect } from 'vitest';
import { rateInputSchema, checkRateBusinessRules, addDays, isValidDateString, istDate } from '../src';

const parse = (o: unknown) => rateInputSchema.safeParse(o);
const good = { k24: '11250', k22: '10305.5', k18: 8437 };
const ctx = { date: '2026-09-18', today: '2026-09-17' };

describe('input parsing', () => {
  it('keeps values exactly as typed (no rounding / deriving)', () => {
    const r = parse(good);
    expect(r.success && r.data).toMatchObject({ k24: 11250, k22: 10305.5, k18: 8437 });
  });
  it('requires all three purities', () => {
    expect(parse({ k24: 11250 }).success).toBe(false);
    expect(parse({ k24: 11250, k22: '', k18: 8437 }).success).toBe(false);
  });
  it('rejects commas, symbols, >2 decimals, zero, negatives', () => {
    for (const bad of ['11,250', '₹11250', '11250.123', '0', '-5', 'abc']) {
      expect(parse({ ...good, k24: bad }).success, bad).toBe(false);
    }
  });
  it('validates extra purities', () => {
    expect(parse({ ...good, extraPurities: [{ label: '14K', value: '6560' }] }).success).toBe(true);
    expect(parse({ ...good, extraPurities: [{ label: '', value: '6560' }] }).success).toBe(false);
  });
});

describe('business rules', () => {
  const inp = (o = {}) => rateInputSchema.parse({ ...good, ...o });
  it('accepts a normal rate', () => expect(checkRateBusinessRules(inp(), ctx).ok).toBe(true));
  it('blocks past dates', () => expect(checkRateBusinessRules(inp(), { date: '2026-09-16', today: '2026-09-17' }).ok).toBe(false));
  it('blocks extra digit / missing digit', () => {
    expect(checkRateBusinessRules(inp({ k24: '112500' }), ctx).ok).toBe(false);
    expect(checkRateBusinessRules(inp({ k18: '843' }), ctx).ok).toBe(false);
  });
  it('blocks wrong ordering', () => {
    expect(checkRateBusinessRules(inp({ k22: '11300' }), ctx).ok).toBe(false);
    expect(checkRateBusinessRules(inp({ k18: '10400' }), ctx).ok).toBe(false);
  });
  it('blocks duplicate or reserved extra labels', () => {
    expect(checkRateBusinessRules(inp({ extraPurities: [{ label: '14K', value: 6500 }, { label: '14k', value: 6400 }] }), ctx).ok).toBe(false);
    expect(checkRateBusinessRules(inp({ extraPurities: [{ label: '22K', value: 6500 }] }), ctx).ok).toBe(false);
  });
  it('big day change needs an override reason', () => {
    const previous = { date: '2026-09-17', k24: 10000 };
    expect(checkRateBusinessRules(inp(), { ...ctx, previous }).ok).toBe(false);
    const r = checkRateBusinessRules(inp({ overrideReason: 'Budget duty cut' }), { ...ctx, previous });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });
  it('warns when rate is unchanged', () => {
    const r = checkRateBusinessRules(inp(), { ...ctx, previous: { date: '2026-09-17', k24: 11250 } });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/same/);
  });
});

describe('dates', () => {
  it('works in IST', () => {
    expect(istDate(new Date('2026-09-17T19:00:00Z'))).toBe('2026-09-18'); // 00:30 IST next day
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isValidDateString('2026-02-30')).toBe(false);
  });
});
