import { Schema, model } from 'mongoose';
import { SEND_DAY_STATUSES } from '@chheda/shared';

/** One row per calendar day: what the scheduler did (used for re-checks, cutoff and missed-run recovery). */
const sendDaySchema = new Schema({
  date: { type: String, required: true, unique: true },
  status: { type: String, enum: SEND_DAY_STATUSES, default: 'pending' },
  reason: String,
  firstAttemptAt: Date,
  lastCheckAt: Date,
  sentAt: Date,
  closedAt: Date,
  healthCheckAt: Date,
  attempts: { type: Number, default: 0 },
}, { timestamps: true, collection: 'send_days' });

export const SendDay = model('SendDay', sendDaySchema);
