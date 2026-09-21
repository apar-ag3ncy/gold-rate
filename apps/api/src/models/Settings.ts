import { Schema, model } from 'mongoose';
import { DEFAULT_CAPTION_TEMPLATE, DEFAULT_IBJA_SETTINGS, DEFAULT_KEYWORD_REPLY, DEFAULT_MANUAL_REMINDER_MIN, DEFAULT_WHATSAPP_TEMPLATE } from '@chheda/shared';

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
  manualReminderMinutes: { type: Number, default: DEFAULT_MANUAL_REMINDER_MIN },
  ibja: {
    enabled: { type: Boolean, default: DEFAULT_IBJA_SETTINGS.enabled },
    autoDraft: { type: Boolean, default: DEFAULT_IBJA_SETTINGS.autoDraft },
    autoApprove: { type: Boolean, default: DEFAULT_IBJA_SETTINGS.autoApprove },
    draftFor: { type: String, enum: ['today', 'tomorrow'], default: DEFAULT_IBJA_SETTINGS.draftFor },
    preferSession: { type: String, enum: ['AM', 'PM'], default: DEFAULT_IBJA_SETTINGS.preferSession },
    fetchTimes: { type: [String], default: () => [...DEFAULT_IBJA_SETTINGS.fetchTimes] },
    maxAgeDays: { type: Number, default: DEFAULT_IBJA_SETTINGS.maxAgeDays },
  },
  keywordReply: {
    triggers: { type: [String], default: () => [...DEFAULT_KEYWORD_REPLY.triggers] },
    maxPerSenderPerDay: { type: Number, default: DEFAULT_KEYWORD_REPLY.maxPerSenderPerDay },
    notReadyMessage: { type: String, default: DEFAULT_KEYWORD_REPLY.notReadyMessage },
  },
  adminAlerts: {
    emails: { type: [String], default: [] },
    // admin WhatsApp numbers: encrypted like subscribers, masked for display
    whatsappNumbers: { type: [{ enc: String, masked: String, _id: false }], default: [] },
    templateName: { type: String, default: 'admin_alert' },      // approved UTILITY template: {{1}} title, {{2}} message
    templateLanguage: { type: String, default: 'en' },
  },
  whatsapp: {
    templateName: { type: String, default: DEFAULT_WHATSAPP_TEMPLATE.templateName },
    templateLanguage: { type: String, default: DEFAULT_WHATSAPP_TEMPLATE.templateLanguage },
    includeExtrasParam: { type: Boolean, default: DEFAULT_WHATSAPP_TEMPLATE.includeExtrasParam },
  },
  channels: {
    igFeed: { type: Boolean, default: true },
    igStory: { type: Boolean, default: true },
    waCustomers: { type: Boolean, default: true },
    staffShare: { type: Boolean, default: false },   // staff share app removed from the dashboard (Sep 2026)
    rateKeywordReply: { type: Boolean, default: false },   // keyword auto-reply hidden from the dashboard (Sep 2026)
  },
}, { timestamps: true });

export const Settings = model('Settings', settingsSchema);
export async function getSettings() {
  return (await Settings.findById('main')) ?? (await Settings.create({ _id: 'main' }));
}
