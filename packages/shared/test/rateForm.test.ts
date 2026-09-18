import { describe, it, expect } from 'vitest';
import { addDays, defaultDeliveryLogRange, rateFormIsDirty, rateInputSchema, rateToForm, sameRateValue, typedToNumber } from '../src';

const saved = { k24: 11250, k22: 10305.5, k18: 8512.5, extraPurities: [{ label: '14K', value: 6560 }] };
const form = (over: Partial<Record<'k24' | 'k22' | 'k18', string>> = {}, extras = [{ label: '14K', value: '6560' }]) => ({ k24: '11250', k22: '10305.5', k18: '8512.5', ...over, extraPurities: extras });

describe('BUG 1 – dirty check compares values, not text', () => {
  it('trailing zeros and formatting never make the form dirty', () => {
    for (const t of ['8512.50', '8512.5', '8512.500', ' 8512.5 ']) { expect(sameRateValue(t, 8512.5), t).toBe(true); expect(rateFormIsDirty(form({ k18: t }), saved), t).toBe(false); }
    expect(sameRateValue('0.10', 0.1)).toBe(true);
    expect(sameRateValue(8512.5, 8512.5)).toBe(true);
    expect(rateFormIsDirty(form({}, [{ label: ' 14K ', value: '6560.00' }]), saved)).toBe(false);
  });
  it('a real change is still detected', () => {
    expect(rateFormIsDirty(form({ k18: '8512.51' }), saved)).toBe(true);
    expect(rateFormIsDirty(form({ k18: '' }), saved)).toBe(true);
    expect(rateFormIsDirty(form({ k18: 'abc' }), saved)).toBe(true);
    expect(rateFormIsDirty(form({}, []), saved)).toBe(true);
    expect(rateFormIsDirty(form({}, [{ label: '18K', value: '6560' }]), saved)).toBe(true);
    expect(rateFormIsDirty(form({}, [{ label: '14K', value: '6561' }]), saved)).toBe(true);
    expect(sameRateValue('', 5)).toBe(false); expect(sameRateValue('1,000', 1000)).toBe(false);
  });
  it('the API stores exactly the typed value (numerically) and the form resets to it', () => {
    for (const t of ['8512.50', '8512.5']) expect(rateInputSchema.parse({ k24: '11250', k22: '10305.5', k18: t }).k18).toBe(8512.5);
    expect(rateInputSchema.parse({ k24: '11250', k22: '10305.5', k18: '8437', extraPurities: [{ label: '9K', value: '0.10' }] }).extraPurities[0].value).toBe(0.1);
    // SPEC §5: max 2 decimals is a business rule – "8512.500" is blocked (never silently rounded)
    expect(rateInputSchema.safeParse({ k24: '11250', k22: '10305.5', k18: '8512.500' }).success).toBe(false);
    expect(rateToForm(saved)).toEqual({ k24: '11250', k22: '10305.5', k18: '8512.5', extraPurities: [{ label: '14K', value: '6560' }], overrideReason: '' });
    expect(typedToNumber('8512.50')).toBe(8512.5); expect(typedToNumber('x')).toBeNull();
  });
});

describe('BUG 4 – delivery log default range includes the coming week', () => {
  it('spans −30 … +7 days', () => expect(defaultDeliveryLogRange('2026-09-18', addDays)).toEqual({ from: '2026-08-19', to: '2026-09-25' }));
});
