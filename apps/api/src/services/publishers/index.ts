import type { DeliveryChannel } from '@chheda/shared';
import type { Config } from '../../config';
import { logger } from '../../lib/logger';
import { getSettings } from '../../models';
import { MetaClient, PublishError, type FetchLike } from '../meta/client';
import { getIntegrationCreds } from '../integrations';

/** Everything a channel needs to post the day's rate. */
export interface PublishPayload {
  date: string;
  feedUrl: string;
  storyUrl: string;
  caption: string;
  rate: { k24: number; k22: number; k18: number; extraPurities: { label: string; value: number }[] };
  rateId?: unknown;
}
export interface PublishResult { externalId?: string; detail?: string; stats?: { total: number; sent: number; failed: number; skipped: number } }

/** A channel publisher. Throw PublishError/MetaApiError with `retryable` so the pipeline knows whether to retry. */
export interface Publisher {
  readonly channel: DeliveryChannel;
  publish(payload: PublishPayload): Promise<PublishResult>;
}

export const AUTO_CHANNELS = ['ig_feed', 'ig_story', 'wa_customers'] as const satisfies readonly DeliveryChannel[];
export const MANUAL_CHANNELS = ['ig_broadcast_manual', 'wa_channel_manual', 'wa_community_manual'] as const satisfies readonly DeliveryChannel[];
export type AutoChannel = (typeof AUTO_CHANNELS)[number];

export class DryRunPublisher implements Publisher {
  constructor(readonly channel: DeliveryChannel) {}
  async publish(p: PublishPayload): Promise<PublishResult> {
    logger.info({ channel: this.channel, date: p.date, feed: p.feedUrl, story: p.storyUrl }, `DRY_RUN publish → ${this.channel} (nothing sent)`);
    return { externalId: `dry-run:${this.channel}:${p.date}`, detail: 'DRY_RUN' };
  }
}

/** Live mode but the channel has no working connection → permanent, clear failure (never silently skipped). */
export class NotConnectedPublisher implements Publisher {
  constructor(readonly channel: DeliveryChannel, private readonly why: string) {}
  async publish(): Promise<PublishResult> { throw new PublishError(`${this.channel}: ${this.why}`, false); }
}

export type PublisherMap = Partial<Record<AutoChannel, Publisher>>;

export function createDryRunPublishers(): PublisherMap {
  return Object.fromEntries(AUTO_CHANNELS.map((c) => [c, new DryRunPublisher(c)])) as PublisherMap;
}

/**
 * DRY_RUN=true → log-only publishers (default). DRY_RUN=false → live official Meta publishers,
 * each only when its integration is connected; otherwise a NotConnectedPublisher so the failure is explicit.
 */
export async function createPublishers(cfg: Config, opts: { fetchFn?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}): Promise<PublisherMap> {
  if (cfg.DRY_RUN) {
    // In DRY_RUN the WhatsApp publisher still walks the subscriber list (rows + counts) without calling Meta.
    const { WhatsAppPublisher } = await import('./whatsapp');
    const s = await getSettings();
    const client = new MetaClient(cfg, opts.fetchFn);
    return {
      ig_feed: new DryRunPublisher('ig_feed'), ig_story: new DryRunPublisher('ig_story'),
      wa_customers: new WhatsAppPublisher(client, { phoneNumberId: 'dry-run', accessToken: '' }, s.whatsapp as any, { dryRun: true, concurrency: cfg.WA_SEND_CONCURRENCY, delayMs: 0, sleep: opts.sleep }),
    };
  }
  const { InstagramPublisher } = await import('./instagram');
  const { WhatsAppPublisher } = await import('./whatsapp');
  const client = new MetaClient(cfg, opts.fetchFn);
  const s = await getSettings();
  const ig = await getIntegrationCreds('instagram');
  const wa = await getIntegrationCreds('whatsapp');
  const igPub = (channel: 'ig_feed' | 'ig_story') => ig.ok
    ? new InstagramPublisher(channel, client, { igUserId: ig.accountId, accessToken: ig.token }, { timeoutMs: cfg.IG_PUBLISH_TIMEOUT_MS, sleep: opts.sleep })
    : new NotConnectedPublisher(channel, ig.reason);
  return {
    ig_feed: igPub('ig_feed'),
    ig_story: igPub('ig_story'),
    wa_customers: wa.ok
      ? new WhatsAppPublisher(client, { phoneNumberId: wa.phoneNumberId, accessToken: wa.token }, s.whatsapp as any, { concurrency: cfg.WA_SEND_CONCURRENCY, delayMs: cfg.WA_SEND_DELAY_MS, sleep: opts.sleep })
      : new NotConnectedPublisher('wa_customers', wa.reason),
  };
}
