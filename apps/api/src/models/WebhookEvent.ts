import { Schema, model } from 'mongoose';

/** Raw webhook payloads kept for 7 days (debugging) with a unique eventKey so duplicates are ignored. */
const webhookEventSchema = new Schema({
  source: { type: String, enum: ['whatsapp', 'instagram'], required: true },
  eventKey: { type: String, required: true, unique: true },
  kind: String,                       // status | message | other
  payload: Schema.Types.Mixed,
  processedAt: Date,
  error: String,
  receivedAt: { type: Date, default: Date.now },
}, { timestamps: false, collection: 'webhook_events' });
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
