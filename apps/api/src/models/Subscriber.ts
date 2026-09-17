import { Schema, model } from 'mongoose';
import { OPT_IN_SOURCES, SUBSCRIBER_STATUSES } from '@chheda/shared';

/** SPEC §7 wa_subscribers: phone encrypted (AES-256-GCM) + keyed hash for lookup. The plain number is never stored or logged. */
const subscriberSchema = new Schema({
  phoneEnc: { type: String, required: true, select: false },
  phoneHash: { type: String, required: true, unique: true },
  phoneMasked: { type: String, required: true },     // "+91••••••1234"
  name: String,
  optInAt: { type: Date, required: true },
  optInSource: { type: String, enum: OPT_IN_SOURCES, required: true },
  optOutAt: Date,
  status: { type: String, enum: SUBSCRIBER_STATUSES, default: 'active', index: true },
  lastDeliveryStatus: String,
  lastDeliveryAt: Date,
  lastError: String,
  addedBy: String,
}, { timestamps: true, collection: 'wa_subscribers' });

export const Subscriber = model('Subscriber', subscriberSchema);
