import { Schema, model } from 'mongoose';
import { INTEGRATION_CHANNELS, INTEGRATION_STATUSES } from '@chheda/shared';

/** SPEC §7 integrations. The access token is stored AES-256-GCM encrypted and is never returned by the API. */
const integrationSchema = new Schema({
  channel: { type: String, enum: INTEGRATION_CHANNELS, required: true, unique: true },
  encryptedToken: { type: String, select: false },
  tokenTail: String,                 // "…a1b2" for display only
  accountId: String,                 // Instagram: IG user id · WhatsApp: WABA id
  phoneNumberId: String,             // WhatsApp: phone number id
  displayName: String,               // @username / display phone number from the last successful test
  expiresAt: Date,                   // token expiry (null = never / unknown)
  lastHealthCheck: Date,
  status: { type: String, enum: INTEGRATION_STATUSES, default: 'not_configured' },
  lastError: String,
  updatedBy: String,
}, { timestamps: true });

export const Integration = model('Integration', integrationSchema);
