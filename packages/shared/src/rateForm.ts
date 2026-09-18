/**
 * Helpers shared by the Enter Rate form and its tests.
 * The form holds text exactly as typed ("8512.50"); the API stores the numeric value (8512.5) – same value, different text.
 */
export interface RateFormValues { k24: string; k22: string; k18: string; extraPurities: { label: string; value: string }[] }
export interface StoredRateValues { k24: number; k22: number; k18: number; extraPurities: { label: string; value: number }[] }

/** "8512.50", "8512.5", "8512.500" and 8512.5 are the same rate; "" or "abc" never equals a stored number. */
export function sameRateValue(typed: string | number, stored: number | undefined | null): boolean {
  if (stored == null) return false;
  const s = String(typed).trim();
  if (s === '' || !/^\d+(\.\d+)?$/.test(s)) return false;
  return Number(s) === stored;
}

/** True when the form differs from the saved rate by VALUE (not by text formatting). */
export function rateFormIsDirty(form: RateFormValues, saved: StoredRateValues | null | undefined): boolean {
  if (!saved) return false;
  if (!sameRateValue(form.k24, saved.k24) || !sameRateValue(form.k22, saved.k22) || !sameRateValue(form.k18, saved.k18)) return true;
  if (form.extraPurities.length !== saved.extraPurities.length) return true;
  return form.extraPurities.some((p, i) => p.label.trim() !== saved.extraPurities[i].label.trim() || !sameRateValue(p.value, saved.extraPurities[i].value));
}

/** Form text for a saved rate (what the inputs show after load / save). */
export function rateToForm(saved: StoredRateValues & { overrideReason?: string }): RateFormValues & { overrideReason: string } {
  return { k24: String(saved.k24), k22: String(saved.k22), k18: String(saved.k18), extraPurities: saved.extraPurities.map((p) => ({ label: p.label, value: String(p.value) })), overrideReason: saved.overrideReason ?? '' };
}

/** Typed text → the number the API will store, or null when it is not a plain number (used for live previews). */
export const typedToNumber = (s: string): number | null => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : null);

/** Delivery log default window: last 30 days up to a week ahead, so tomorrow's test sends are visible. */
export function defaultDeliveryLogRange(today: string, addDays: (d: string, n: number) => string) {
  return { from: addDays(today, -30), to: addDays(today, 7) };
}
