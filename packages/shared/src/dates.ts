export const IST_TZ = 'Asia/Kolkata';

/** YYYY-MM-DD for the given instant in IST. */
export function istDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
}

/** HH:mm for the given instant in IST. */
export function istTime(d: Date = new Date()): string {
  return d.toLocaleTimeString('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
