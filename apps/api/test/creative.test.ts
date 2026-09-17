import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildCreativeSvg, renderCreative, renderCreatives } from '../src/services/creative';

const base = { date: '2026-09-18', k24: 11250, k22: 10305.5, k18: 8437 };

describe('creative SVG template', () => {
  it('contains brand, date in words, exact values and footer', () => {
    const svg = buildCreativeSvg('feed', base);
    expect(svg).toContain('CHHEDA JEWELLERS');
    expect(svg).toContain('Fri, 18 Sept 2026');
    expect(svg).toContain('₹11,250 /g');
    expect(svg).toContain('₹10,305.5 /g');   // never rounded
    expect(svg).toContain('₹8,437 /g');
    expect(svg).toContain('Rates per gram · Excl. GST &amp; making charges');
    expect(svg).toContain('#1d1a14');
    expect(svg).toContain('#c9a449');
  });
  it('never rounds or derives values', () => {
    const svg = buildCreativeSvg('story', { ...base, k22: 10305.5, k18: '8437.25' });
    expect(svg).toContain('₹10,305.5 /g');
    expect(svg).toContain('₹8,437.25 /g');
    expect(svg).not.toContain('10,306');
    expect(svg).not.toContain('10,305.50');
  });
  it('shows extra purities only when present, escaping user text', () => {
    expect(buildCreativeSvg('feed', base)).not.toContain('Hallmark');
    const svg = buildCreativeSvg('feed', { ...base, extraPurities: [{ label: '14K <Hallmark> & Co', value: 6560.5 }] });
    expect(svg).toContain('14K &lt;Hallmark&gt; &amp; Co');
    expect(svg).toContain('₹6,560.5 /g');
  });
  it('lays out 0–10 extra purities in both sizes without overflowing', () => {
    for (const kind of ['feed', 'story'] as const) {
      for (let n = 0; n <= 10; n++) {
        const extras = Array.from({ length: n }, (_, i) => ({ label: `${20 - i}K Hallmark`, value: 6000 + i * 111.25 }));
        const svg = buildCreativeSvg(kind, { ...base, extraPurities: extras });
        for (const e of extras) expect(svg).toContain(e.label);
      }
    }
    const eleven = Array.from({ length: 11 }, (_, i) => ({ label: `P${i}`, value: 5000 }));
    expect(() => buildCreativeSvg('feed', { ...base, extraPurities: eleven })).toThrow();
  });
});

describe('creative rendering (sharp)', () => {
  it('renders feed 1080x1080 and story 1080x1920 JPEGs', async () => {
    const { feed, story } = await renderCreatives({ ...base, extraPurities: [{ label: '14K', value: 6560 }] });
    const f = await sharp(feed).metadata();
    const s = await sharp(story).metadata();
    expect([f.format, f.width, f.height]).toEqual(['jpeg', 1080, 1080]);
    expect([s.format, s.width, s.height]).toEqual(['jpeg', 1080, 1920]);
  });
  it('is deterministic for the same input (bundled fonts, no system fonts)', async () => {
    const a = await renderCreative('feed', base);
    const b = await renderCreative('feed', base);
    expect(a.equals(b)).toBe(true);
    expect(process.env.FONTCONFIG_FILE).toMatch(/chheda-fontconfig/);
  });
});
