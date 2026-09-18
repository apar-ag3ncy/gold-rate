import { describe, it, expect } from 'vitest';
import { DEFAULT_RATE_TRIGGERS, matchesRateKeyword, normaliseKeywordText, classifyKeyword } from '../src';

describe('RATE keyword matching', () => {
  it('matches the defaults exactly, ignoring case, spacing and punctuation', () => {
    for (const m of ['rate', 'RATE', '  Rate!! ', 'Gold  Rate', 'gold rate?', 'rate today', 'Today Rate.', 'Aaj ka rate', 'AAJ KA RATE!!!', 'bhav', '“Bhav”', 'rate…']) expect(matchesRateKeyword(m), m).toBe(true);
  });
  it('does not reply to ordinary messages or keywords buried in text', () => {
    for (const m of ['hello', 'what is the rate of the bangle', 'rate my order', 'rates', '', undefined, null, 'gold', 'thanks for the rate']) expect(matchesRateKeyword(m as any), String(m)).toBe(false);
  });
  it('uses the configured trigger list', () => {
    expect(matchesRateKeyword('sona', ['sona'])).toBe(true);
    expect(matchesRateKeyword('rate', ['sona'])).toBe(false);
    expect(matchesRateKeyword('Sona Bhav', ['sona bhav '])).toBe(true);
  });
  it('normalises Hindi/Unicode text safely', () => {
    expect(normaliseKeywordText('भाव!')).toBe('भाव');
    expect(matchesRateKeyword('भाव', ['भाव'])).toBe(true);
    expect(DEFAULT_RATE_TRIGGERS).toContain('bhav');
  });
  it('JOIN / STOP classification is untouched', () => {
    expect(classifyKeyword('JOIN')).toBe('join');
    expect(classifyKeyword('stop')).toBe('stop');
  });
});
