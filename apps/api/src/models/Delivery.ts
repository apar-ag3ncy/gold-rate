import { Schema, model } from 'mongoose';
import { DELIVERY_CHANNELS, DELIVERY_STATUSES, DELIVERY_TRIGGERS } from '@chheda/shared';

/**
 * One row per (date, channel, attempt-group). SPEC §7.
 * idempotencyKey is unique + sparse: real sends use "YYYY-MM-DD:channel" so a duplicate post is impossible;
 * test / keyword rows carry a nonce so they never block a real send.
 */
const deliverySchema = new Schema({
  rateId: { type: Schema.Types.ObjectId, ref: 'Rate' },
  date: { type: String, required: true, index: true },            // YYYY-MM-DD (IST)
  channel: { type: String, enum: DELIVERY_CHANNELS, required: true },
  trigger: { type: String, enum: DELIVERY_TRIGGERS, required: true },
  idempotencyKey: { type: String, unique: true, sparse: true },
  status: { type: String, enum: DELIVERY_STATUSES, required: true, index: true },
  recipient: String,            // for test sends: the admin (never a customer)
  dryRun: { type: Boolean, default: true },
  requestedBy: String,
  postedBy: String,             // manual channels: staff member who marked it posted
  externalId: String,           // Meta media id / message id (Phase 4)
  error: String,
  attempts: { type: Number, default: 0 },
  creativeUrls: { feed: String, story: String },
  caption: String,
  rateSnapshot: { k24: Number, k22: Number, k18: Number, extraPurities: [{ label: String, value: Number, _id: false }] },
  // ---- Phase 4: per-recipient WhatsApp rows + Meta error details ----
  recipientHash: String,        // set on per-subscriber rows (key date:wa_cloud:<hash>); absent on channel-level rows
  recipientMasked: String,
  waStatus: String,             // sent | delivered | read | failed (from webhooks)
  waStatusAt: Date,
  metaErrorCode: Number,
  metaErrorMessage: String,
  retryable: Boolean,
  stats: { total: Number, sent: Number, failed: Number, skipped: Number },
}, { timestamps: true });
deliverySchema.index({ date: 1, channel: 1 });
deliverySchema.index({ externalId: 1 }, { sparse: true });

export const Delivery = model('Delivery', deliverySchema);
