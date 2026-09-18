import { describe, it, expect } from 'vitest';
import { MANUAL_SHARE_CHANNELS, MANUAL_CHANNEL_INFO, CUSTOMER_CHANNELS, DELIVERY_CHANNELS, ALERT_TYPES } from '../src';

describe('manual share channels', () => {
  it('three manual channels, all customer-facing, all with labels', () => {
    expect(MANUAL_SHARE_CHANNELS).toEqual(['ig_broadcast_manual', 'wa_channel_manual', 'wa_community_manual']);
    for (const c of MANUAL_SHARE_CHANNELS) { expect(DELIVERY_CHANNELS).toContain(c); expect(CUSTOMER_CHANNELS).toContain(c); expect(MANUAL_CHANNEL_INFO[c].label).toBeTruthy(); }
    expect(ALERT_TYPES).toContain('partial_send');
  });
});
