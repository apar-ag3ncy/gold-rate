import { Schema, model } from 'mongoose';

/** Web-push subscriptions (one per browser/device). endpoint is unique; removed automatically on 404/410. */
const pushSubscriptionSchema = new Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userEmail: String,
  role: { type: String, required: true, index: true },
  userAgent: String,
  lastUsedAt: Date,
  failures: { type: Number, default: 0 },
}, { timestamps: true, collection: 'push_subscriptions' });

export const PushSubscription = model('PushSubscription', pushSubscriptionSchema);
