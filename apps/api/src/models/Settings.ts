import { Schema, model } from 'mongoose';
import { DEFAULT_CAPTION_TEMPLATE, DEFAULT_WHATSAPP_TEMPLATE } from '@chheda/shared';

const settingsSchema = new Schema({
  _id: { type: String, default: 'main' },
  automationOn: { type: Boolean, default: false },
  sendTime: { type: String, default: '07:00' },      // HH:mm IST
  cutoffTime: { type: String, default: '11:00' },    // admin-configurable late-send cutoff
  timezone: { type: String, default: 'Asia/Kolkata' },
  priceMin: { type: Number, default: 1000 },
  priceMax: { type: Number, default: 50000 },
  maxDailyChangePct: { type: Number, default: 5 },
  captionTemplate: { type: String, default: DEFAULT_CAPTION_TEMPLATE },
  whatsapp: {
    templateName: { type: String, default: DEFAULT_WHATSAPP_TEMPLATE.templateName },
    templateLanguage: { type: String, default: DEFAULT_WHATSAPP_TEMPLATE.templateLanguage },
    includeExtrasParam: { type: Boolean, default: DEFAULT_WHATSAPP_TEMPLATE.includeExtrasParam },
  },
  channels: {
    igFeed: { type: Boolean, default: true },
    igStory: { type: Boolean, default: true },
    waCustomers: { type: Boolean, default: true },
    staffShare: { type: Boolean, default: true },
    rateKeywordReply: { type: Boolean, default: true },
  },
}, { timestamps: true });

export const Settings = model('Settings', settingsSchema);
export async function getSettings() {
  return (await Settings.findById('main')) ?? (await Settings.create({ _id: 'main' }));
}
