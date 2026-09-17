import { formatDateWords, formatPerGram } from '@chheda/shared';
import { FONT_SANS, FONT_SERIF } from './fonts';

/**
 * SVG creative for the daily rate. Values are printed EXACTLY as entered (formatPerGram never rounds).
 * Brand: dark #1d1a14 with gold #c9a449, serif brand mark, spaced caps – matches docs/brand-banner.png.
 */
export type CreativeKind = 'feed' | 'story';
export interface CreativeData {
  date: string;                       // YYYY-MM-DD
  k24: number | string; k22: number | string; k18: number | string;
  extraPurities?: { label: string; value: number | string }[];
}

export const CREATIVE_SIZES: Record<CreativeKind, { width: number; height: number }> = {
  feed: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

export const BRAND = {
  name: 'CHHEDA JEWELLERS',
  footer: 'Rates per gram · Excl. GST & making charges',
  bg: '#1d1a14', card: '#26221a', gold: '#c9a449', goldLight: '#e8cf7a', goldDark: '#8f7128',
  cream: '#fbf7ec', muted: '#b9ad8f',
};

export const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Rough Poppins width estimate (em per char) used only to shrink text that would overflow. */
const fitFontSize = (text: string, maxWidth: number, base: number, min = 14) =>
  Math.max(min, Math.min(base, Math.floor(maxWidth / (text.length * 0.6))));

interface Layout {
  W: number; H: number; frame: number;
  ornamentY: number; brandY: number; brandSize: number; dividerY: number; titleY: number; dateY: number;
  regionTop: number; regionBottom: number; footerY: number;
  rowX: number; rowW: number; extrasCols: (n: number) => number;
  rowH: (extraRows: number) => number; rowGap: (extraRows: number) => number;
  pillH: (extraRows: number) => number; pillGap: number; sectionGap: number;
}

const LAYOUTS: Record<CreativeKind, Layout> = {
  feed: {
    W: 1080, H: 1080, frame: 40,
    ornamentY: 118, brandY: 218, brandSize: 58, dividerY: 254, titleY: 306, dateY: 352,
    regionTop: 392, regionBottom: 976, footerY: 1032,
    rowX: 90, rowW: 900, extrasCols: (n) => (n === 1 ? 1 : n <= 6 ? 2 : 3),
    rowH: (r) => [150, 120, 110, 100, 96][r], rowGap: (r) => [18, 14, 14, 12, 10][r],
    pillH: (r) => (r >= 4 ? 46 : 52), pillGap: 10, sectionGap: 24,
  },
  story: {
    W: 1080, H: 1920, frame: 48,
    ornamentY: 300, brandY: 420, brandSize: 72, dividerY: 464, titleY: 528, dateY: 584,
    regionTop: 640, regionBottom: 1640, footerY: 1706,
    rowX: 90, rowW: 900, extrasCols: (n) => (n === 1 ? 1 : 2),
    rowH: (r) => (r ? 156 : 176), rowGap: (r) => (r ? 20 : 22),
    pillH: () => 72, pillGap: 14, sectionGap: 40,
  },
};

/** Simple original lotus/mandala ornament in gold line-art. */
function ornament(cx: number, cy: number, scale: number) {
  const petals = Array.from({ length: 8 }, (_, i) =>
    `<ellipse cx="0" cy="-26" rx="9" ry="26" transform="rotate(${i * 45})"/>`).join('');
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${BRAND.gold}" stroke-width="2" opacity="0.9">
    ${petals}<circle r="8"/><circle r="40" stroke-opacity="0.45"/></g>`;
}

function divider(cx: number, y: number, halfW: number) {
  return `<g stroke="${BRAND.gold}" stroke-width="1.5" opacity="0.8">
    <line x1="${cx - halfW}" y1="${y}" x2="${cx - 14}" y2="${y}"/><line x1="${cx + 14}" y1="${y}" x2="${cx + halfW}" y2="${y}"/>
    <rect x="${cx - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${cx} ${y})" fill="${BRAND.gold}" stroke="none"/></g>`;
}

export function buildCreativeSvg(kind: CreativeKind, data: CreativeData): string {
  const L = LAYOUTS[kind];
  const extras = data.extraPurities ?? [];
  if (extras.length > 10) throw new Error('At most 10 extra purities are supported');
  const cx = L.W / 2;

  // ---- vertical layout of the rate block (3 main rows + optional extras grid), centred in the region ----
  const cols = extras.length ? L.extrasCols(extras.length) : 0;
  const extraRows = cols ? Math.ceil(extras.length / cols) : 0;
  const rowH = L.rowH(extraRows), rowGap = L.rowGap(extraRows), pillH = L.pillH(extraRows);
  const mainH = 3 * rowH + 2 * rowGap;
  const extrasH = extraRows ? extraRows * pillH + (extraRows - 1) * L.pillGap + L.sectionGap : 0;
  const total = mainH + extrasH;
  const available = L.regionBottom - L.regionTop;
  if (total > available) throw new Error(`Creative layout overflow (${total}px > ${available}px)`);
  let y = L.regionTop + Math.floor((available - total) / 2);

  const main: [string, number | string][] = [['24K', data.k24], ['22K', data.k22], ['18K', data.k18]];
  const rows = main.map(([label, value]) => {
    const v = formatPerGram(value);
    const valueSize = fitFontSize(v, L.rowW - 300, Math.round(rowH * 0.42), 28);
    const labelSize = Math.round(rowH * 0.34);
    const cy = y + rowH / 2;
    const r = `<g>
      <rect x="${L.rowX}" y="${y}" width="${L.rowW}" height="${rowH}" rx="16" fill="${BRAND.card}" stroke="${BRAND.gold}" stroke-opacity="0.35" stroke-width="1.5"/>
      <text x="${L.rowX + 44}" y="${cy}" dominant-baseline="central" font-family="${FONT_SANS}" fill="${BRAND.gold}">
        <tspan font-size="${labelSize}" font-weight="600">${label}</tspan><tspan font-size="${Math.round(labelSize * 0.5)}" dx="10" fill="${BRAND.muted}" letter-spacing="3">GOLD</tspan></text>
      <text x="${L.rowX + L.rowW - 44}" y="${cy}" dominant-baseline="central" text-anchor="end" font-family="${FONT_SANS}" font-weight="600" font-size="${valueSize}" fill="${BRAND.cream}">${escapeXml(v)}</text>
    </g>`;
    y += rowH + rowGap;
    return r;
  });

  let pills = '';
  if (extraRows) {
    y += L.sectionGap - rowGap;
    const gapX = 16;
    const pillW = Math.floor((L.rowW - gapX * (cols - 1)) / cols);
    // one font size for every pill (the longest label decides) so the grid looks uniform
    const fs = Math.min(...extras.map((p) => fitFontSize(`${p.label.trim()}  ${formatPerGram(p.value)}`, pillW - 36, Math.round(pillH * 0.5), 12)));
    pills = extras.map((p, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = L.rowX + c * (pillW + gapX), py = y + r * (pillH + L.pillGap);
      const v = formatPerGram(p.value);
      const label = p.label.trim();
      return `<g>
        <rect x="${x}" y="${py}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="${BRAND.card}" stroke="${BRAND.gold}" stroke-opacity="0.3" stroke-width="1.2"/>
        <text x="${x + pillW / 2}" y="${py + pillH / 2}" dominant-baseline="central" text-anchor="middle" font-family="${FONT_SANS}" font-size="${fs}">
          <tspan fill="${BRAND.gold}" font-weight="600">${escapeXml(label)}</tspan><tspan fill="${BRAND.cream}" dx="${Math.round(fs * 0.5)}">${escapeXml(v)}</tspan></text>
      </g>`;
    }).join('');
  }

  const f = L.frame;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="75%">
      <stop offset="0%" stop-color="${BRAND.gold}" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="${BRAND.gold}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="${BRAND.bg}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="goldText" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BRAND.goldLight}"/><stop offset="55%" stop-color="${BRAND.gold}"/><stop offset="100%" stop-color="${BRAND.goldDark}"/>
    </linearGradient>
  </defs>
  <rect width="${L.W}" height="${L.H}" fill="${BRAND.bg}"/>
  <rect width="${L.W}" height="${L.H}" fill="url(#glow)"/>
  <rect x="${f}" y="${f}" width="${L.W - 2 * f}" height="${L.H - 2 * f}" rx="6" fill="none" stroke="${BRAND.gold}" stroke-opacity="0.55" stroke-width="2"/>
  <rect x="${f + 12}" y="${f + 12}" width="${L.W - 2 * f - 24}" height="${L.H - 2 * f - 24}" rx="4" fill="none" stroke="${BRAND.gold}" stroke-opacity="0.2" stroke-width="1"/>
  ${ornament(cx, L.ornamentY, kind === 'story' ? 1.25 : 1)}
  <text x="${cx}" y="${L.brandY}" text-anchor="middle" font-family="${FONT_SERIF}" font-size="${L.brandSize}" letter-spacing="${Math.round(L.brandSize * 0.22)}" fill="url(#goldText)">${BRAND.name}</text>
  ${divider(cx, L.dividerY, kind === 'story' ? 220 : 180)}
  <text x="${cx}" y="${L.titleY}" text-anchor="middle" font-family="${FONT_SANS}" font-weight="600" font-size="${kind === 'story' ? 30 : 26}" letter-spacing="8" fill="${BRAND.cream}" opacity="0.92">GOLD RATE</text>
  <text x="${cx}" y="${L.dateY}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${kind === 'story' ? 38 : 32}" fill="${BRAND.gold}">${escapeXml(formatDateWords(data.date))}</text>
  ${rows.join('\n')}
  ${pills}
  ${divider(cx, L.footerY - 36, kind === 'story' ? 300 : 260)}
  <text x="${cx}" y="${L.footerY}" text-anchor="middle" font-family="${FONT_SANS}" font-size="${kind === 'story' ? 26 : 22}" letter-spacing="1" fill="${BRAND.muted}">${escapeXml(BRAND.footer)}</text>
</svg>`;
}
