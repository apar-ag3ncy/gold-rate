import { Schema, model } from 'mongoose';
import { ALERT_SEVERITIES, ALERT_TYPES } from '@chheda/shared';

/** SPEC §7 alerts. dedupeKey (unique, sparse) stops a 15-minute re-check from raising the same alert again. */
const alertSchema = new Schema({
  type: { type: String, enum: ALERT_TYPES, required: true },
  severity: { type: String, enum: ALERT_SEVERITIES, default: 'warning' },
  message: { type: String, required: true },
  date: { type: String, index: true },           // YYYY-MM-DD the alert is about
  dedupeKey: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['open', 'acked'], default: 'open', index: true },
  ackBy: String,
  ackAt: Date,
  meta: Schema.Types.Mixed,
  // Phase 4B: admin notification fan-out (email + WhatsApp utility template), de-duplicated per type+date per 30 min
  notifiedAt: Date,
  notifications: { type: [{ channel: String, to: String, status: String, error: String, at: Date, _id: false }], default: [] },
}, { timestamps: true });
alertSchema.index({ type: 1, date: 1, notifiedAt: -1 });

export const Alert = model('Alert', alertSchema);
