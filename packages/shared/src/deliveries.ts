/** Delivery channels. Manual ones are shared by staff with 1 tap (no official API). */
export const DELIVERY_CHANNELS = ['ig_feed', 'ig_story', 'wa_customers', 'wa_admin', 'ig_broadcast_manual', 'wa_channel_manual', 'wa_community_manual'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_TRIGGERS = ['cron', 'send_now', 'test', 'keyword'] as const;
export type DeliveryTrigger = (typeof DELIVERY_TRIGGERS)[number];

export const DELIVERY_STATUSES = ['queued', 'success', 'failed', 'pending_manual', 'skipped', 'test'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Channels that reach customers. A test send must never use one of these. */
export const CUSTOMER_CHANNELS: readonly DeliveryChannel[] = ['ig_feed', 'ig_story', 'wa_customers', 'ig_broadcast_manual', 'wa_channel_manual', 'wa_community_manual'];

/** Channels with no official API – staff post them with 1 tap and press "Mark posted". */
export const MANUAL_SHARE_CHANNELS = ['ig_broadcast_manual', 'wa_channel_manual', 'wa_community_manual'] as const;
export type ManualShareChannel = (typeof MANUAL_SHARE_CHANNELS)[number];
export const MANUAL_CHANNEL_INFO: Record<ManualShareChannel, { label: string; app: 'instagram' | 'whatsapp'; hint: string }> = {
  ig_broadcast_manual: { label: 'Instagram Broadcast Channel', app: 'instagram', hint: 'Open Instagram → your broadcast channel → share the feed image with the caption.' },
  wa_channel_manual: { label: 'WhatsApp Channel', app: 'whatsapp', hint: 'Open WhatsApp → Updates → your channel → post the feed image with the caption.' },
  wa_community_manual: { label: 'WhatsApp Community', app: 'whatsapp', hint: 'Open WhatsApp → the community announcement group → send the feed image with the caption.' },
};

export interface StaffTodayReady {
  ready: true;
  date: string;
  feedUrl: string;
  storyUrl: string;
  caption: string;
  tasks: { id: string; channel: ManualShareChannel; status: 'pending_manual' | 'success'; postedBy?: string; postedAt?: string; createdAt: string }[];
}
export interface StaffTodayNotReady {
  ready: false;
  date: string;
  reason: 'no_rate' | 'not_approved' | 'cancelled' | 'before_send_time' | 'skipped' | 'staff_share_off';
  message: string;
  sendTime?: string;
}
export type StaffToday = StaffTodayReady | StaffTodayNotReady;

/**
 * Idempotency key (unique index on deliveries).
 * Real sends: exactly one per date+channel → "YYYY-MM-DD:channel" (rule 5 in CLAUDE.md).
 * Test / keyword replies may legitimately repeat, so they carry a nonce and can never collide with a real send.
 */
export function deliveryIdempotencyKey(date: string, channel: DeliveryChannel, trigger: DeliveryTrigger, nonce?: string): string {
  if (trigger === 'cron' || trigger === 'send_now') return `${date}:${channel}`;
  if (!nonce) throw new Error(`A nonce is required for ${trigger} deliveries`);
  return `${date}:${channel}:${trigger}:${nonce}`;
}

export interface DeliveryDTO {
  id: string;
  rateId?: string;
  date: string;
  channel: DeliveryChannel;
  trigger: DeliveryTrigger;
  status: DeliveryStatus;
  idempotencyKey?: string;
  recipient?: string;
  dryRun: boolean;
  requestedBy?: string;
  postedBy?: string;
  externalId?: string;
  error?: string;
  attempts: number;
  creativeUrls?: { feed?: string; story?: string };
  caption?: string;
  createdAt: string;
  updatedAt: string;
}
