import { ibjaDateToIso, type IbjaPer10g, type IbjaSession } from '@chheda/shared';

export interface ParsedIbjaPage {
  /** today's table (spans lblGold999_AM / _PM …); a session is present only when its 999 cell has digits */
  today: Partial<Record<IbjaSession, IbjaPer10g>>;
  /** the "Previous Dates Rate" tabs, newest first */
  history: { rateDate: string; session: IbjaSession; per10g: IbjaPer10g }[];
  /** IBJA's own rounded per-gram cards (display only, never used for the rate) */
  perGramCards: Partial<Record<'999' | '995' | '916' | '750' | '585', string>>;
}

/** digits only and > 0 – IBJA shows '0' / blank on holidays and before publication, which is NOT a rate */
const num = (s: string | undefined) => { const t = (s ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;|\u00a0|\s|,/g, ''); return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 ? t : undefined; };
const span = (html: string, id: string) => num(new RegExp(`id="${id}"[^>]*>([\\s\\S]{0,200}?)</span>`).exec(html)?.[1]);

/** Parses the ibjarates.com homepage. Pure – tested against a saved fixture. Throws when the expected markup is missing. */
export function parseIbjaHomepage(html: string): ParsedIbjaPage {
  if (!/lblGold999_AM/.test(html)) throw new Error('IBJA page layout changed: today-table markup not found');
  const today: ParsedIbjaPage['today'] = {};
  for (const session of ['AM', 'PM'] as const) {
    const p: IbjaPer10g = {
      '999': span(html, `lblGold999_${session}`), '995': span(html, `lblGold995_${session}`), '916': span(html, `lblGold916_${session}`),
      '750': span(html, `lblGold750_${session}`), '585': span(html, `lblGold585_${session}`),
      silver999: span(html, `lblSilver999_${session}`), platinum999: span(html, `lblPlatinum999_${session}`),
    };
    if (p['999'] && p['916'] && p['750']) today[session] = p;
  }
  const history: ParsedIbjaPage['history'] = [];
  for (const session of ['AM', 'PM'] as const) {
    const tab = new RegExp(`id="tab-${session.toLowerCase()}"[\\s\\S]*?<tbody[^>]*>([\\s\\S]*?)</tbody>`, 'i').exec(html)?.[1] ?? '';
    for (const row of tab.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      const date = /(\d{2}\/\d{2}\/\d{4})/.exec(cells[0] ?? '')?.[1];
      if (!date || cells.length < 6) continue;
      const per10g: IbjaPer10g = { '999': num(cells[1]), '995': num(cells[2]), '916': num(cells[3]), '750': num(cells[4]), '585': num(cells[5]), silver999: num(cells[6]), platinum999: num(cells[7]) };
      if (per10g['999'] && per10g['916'] && per10g['750']) history.push({ rateDate: ibjaDateToIso(date), session, per10g });
    }
  }
  history.sort((a, b) => (a.rateDate === b.rateDate ? (a.session === 'PM' ? -1 : 1) : a.rateDate < b.rateDate ? 1 : -1));
  const perGramCards: ParsedIbjaPage['perGramCards'] = {};
  for (const p of ['999', '995', '916', '750', '585'] as const) { const v = span(html, `GoldRatesCompare${p}`); if (v) perGramCards[p] = v; }
  return { today, history, perGramCards };
}
