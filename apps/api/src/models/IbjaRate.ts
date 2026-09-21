import { Schema, model } from 'mongoose';
import { IBJA_SESSIONS, IBJA_SOURCES } from '@chheda/shared';

/** One IBJA benchmark snapshot per date + session (AM/PM), digits stored exactly as published. */
const ibjaRateSchema = new Schema({
  rateDate: { type: String, required: true },      // YYYY-MM-DD (IST)
  session: { type: String, enum: IBJA_SESSIONS, required: true },
  per10g: { '999': String, '995': String, '916': String, '750': String, '585': String, silver999: String, platinum999: String },
  perGram: { k24: { type: String, required: true }, k22: { type: String, required: true }, k18: { type: String, required: true } },
  source: { type: String, enum: IBJA_SOURCES, required: true },
  fetchedAt: { type: Date, required: true },
}, { timestamps: true, collection: 'ibja_rates' });
ibjaRateSchema.index({ rateDate: 1, session: 1 }, { unique: true });
export const IbjaRate = model('IbjaRate', ibjaRateSchema);

/** One row per fetch attempt (observability + catch-up guard). */
const ibjaFetchSchema = new Schema({
  date: { type: String, required: true },           // IST date of the attempt
  slot: { type: String, required: true },           // "12:40" | "18:40" | "manual" | "catchup"
  at: { type: Date, required: true },
  ok: { type: Boolean, required: true },
  source: String,
  error: String,
  retryable: Boolean,
  snapshots: [{ rateDate: String, session: String, _id: false }],
  by: String,
}, { collection: 'ibja_fetches' });
ibjaFetchSchema.index({ date: 1, slot: 1 });
ibjaFetchSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export const IbjaFetch = model('IbjaFetch', ibjaFetchSchema);
