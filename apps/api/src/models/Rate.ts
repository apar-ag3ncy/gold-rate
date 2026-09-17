import { Schema, model } from 'mongoose';
import { RATE_STATUSES } from '@chheda/shared';

const revisionSchema = new Schema({
  at: { type: Date, required: true },
  by: { type: String, required: true },
  action: { type: String, required: true },
  from: { type: Schema.Types.Mixed },
  to: { type: Schema.Types.Mixed },
}, { _id: false });

const rateSchema = new Schema({
  date: { type: String, required: true, unique: true },   // YYYY-MM-DD (IST)
  unit: { type: String, enum: ['per_gram'], default: 'per_gram' },
  k24: { type: Number, required: true },
  k22: { type: Number, required: true },
  k18: { type: Number, required: true },
  extraPurities: { type: [{ label: String, value: Number, _id: false }], default: [] },
  status: { type: String, enum: RATE_STATUSES, default: 'draft', index: true },
  enteredBy: String,
  approvedBy: String,
  approvedAt: Date,
  overrideReason: String,
  validation: { errors: [String], warnings: [String] },
  revisions: { type: [revisionSchema], default: [] },
  creativeUrls: { feed: String, story: String },   // last rendered preview (never overwritten once sent)
  caption: String,
}, { timestamps: true });

export const Rate = model('Rate', rateSchema);
