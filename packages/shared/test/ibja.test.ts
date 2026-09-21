import { describe, it, expect } from 'vitest';
import { ibjaDateToIso, ibjaRateTimeToSession, isoToIbjaDate, per10gToPerGram, perGramFromPer10g, IBJA_KARAT_MAP } from '../src';

describe('IBJA per-10g → per-gram is an exact decimal shift', () => {
  it('shifts one decimal place without rounding', () => {
    expect(per10gToPerGram('153056')).toBe('15305.6');
    expect(per10gToPerGram('140199')).toBe('14019.9');
    expect(per10gToPerGram('114792')).toBe('11479.2');
    expect(per10gToPerGram('153050')).toBe('15305');
    expect(per10gToPerGram('1,53,056')).toBe('15305.6');
    expect(per10gToPerGram('153056.5')).toBe('15305.65');
    expect(per10gToPerGram('5')).toBe('0.5');
    expect(per10gToPerGram('10')).toBe('1');
  });
  it('rejects anything that is not a number', () => { for (const bad of ['', 'abc', '15,30.5x', '-5']) expect(() => per10gToPerGram(bad), bad).toThrow(); });
  it('maps purities to karats and builds the trio', () => {
    expect(IBJA_KARAT_MAP).toEqual({ k24: '999', k22: '916', k18: '750' });
    expect(perGramFromPer10g({ '999': '153056', '916': '140199', '750': '114792', '995': '152443' })).toEqual({ k24: '15305.6', k22: '14019.9', k18: '11479.2' });
    expect(() => perGramFromPer10g({ '999': '153056', '916': '140199' })).toThrow(/750/);
  });
  it('converts IBJA dates and sessions', () => {
    expect(ibjaDateToIso('21/09/2026')).toBe('2026-09-21'); expect(isoToIbjaDate('2026-09-21')).toBe('21/09/2026');
    expect(ibjaRateTimeToSession('12AM')).toBe('AM'); expect(ibjaRateTimeToSession('6PM')).toBe('PM'); expect(ibjaRateTimeToSession('12 AM')).toBe('AM'); expect(ibjaRateTimeToSession('6:00 pm')).toBe('PM'); expect(ibjaRateTimeToSession('x')).toBeNull(); expect(() => perGramFromPer10g({ '999': '0', '916': '1', '750': '1' })).toThrow(/zero/);
  });
});
