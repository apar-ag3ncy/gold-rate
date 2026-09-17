/**
 * Display formatting for the admin-entered rate.
 * RULE: never round, derive or change a value. We format the digits exactly as stored.
 */

/** Indian digit grouping (12,34,567) applied to a plain number string; the fraction part is left untouched. */
export function groupIndian(numStr: string): string {
  const [intPart, frac] = numStr.split('.');
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/**
 * Exact string form of a stored rate value (max 2 decimals by validation).
 * Number → string conversion is exact for these magnitudes; nothing is rounded.
 */
export function exactNumberString(v: number | string): string {
  const s = typeof v === 'number' ? String(v) : v.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Not a plain positive number: ${s}`);
  return s;
}

/** "₹11,250" or "₹10,305.5" – exactly the entered digits with Indian grouping. */
export function formatInr(v: number | string): string {
  return `₹${groupIndian(exactNumberString(v))}`;
}

/** "₹11,250 /g" */
export function formatPerGram(v: number | string): string {
  return `${formatInr(v)} /g`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** "Thu, 18 Sept 2026" for a YYYY-MM-DD date (calendar date, no timezone shift). */
export function formatDateWords(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Bad date: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${d} ${MONTHS[mo - 1]} ${y}`;
}
