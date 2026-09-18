import crypto from 'node:crypto';
import { CUSTOMER_CHANNELS, deliveryIdempotencyKey } from '@chheda/shared';
import type { Config } from '../config';
import { logger } from '../lib/logger';
import { conflict, HttpError, notFound } from '../lib/errors';
import { Delivery, Rate } from '../models';
import { previewSavedRate } from './preview';
import type { StorageAdapter } from './storage';

export function deliveryToDTO(d: any) {
  return {
    id: String(d._id), rateId: d.rateId ? String(d.rateId) : undefined, date: d.date, channel: d.channel, trigger: d.trigger,
    status: d.status, idempotencyKey: d.idempotencyKey, recipient: d.recipient, dryRun: d.dryRun, requestedBy: d.requestedBy,
    postedBy: d.postedBy, postedAt: d.postedAt, reminderSentAt: d.reminderSentAt, externalId: d.externalId, error: d.error, attempts: d.attempts ?? 0,
    creativeUrls: d.creativeUrls?.feed ? { feed: d.creativeUrls.feed, story: d.creativeUrls.story } : undefined,
    caption: d.caption, stats: d.stats?.total != null ? d.stats : undefined, waStatus: d.waStatus, metaErrorCode: d.metaErrorCode, retryable: d.retryable, createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}

/**
 * Test Send: renders the saved rate for `date` and "sends" it ONLY to the requesting admin.
 * With DRY_RUN (the only mode available until Phase 4) it is logged, never transmitted.
 * Customers are never involved – the channel is wa_admin and CUSTOMER_CHANNELS is asserted.
 */
export async function sendTest(cfg: Config, storage: StorageAdapter, date: string, admin: { email: string; name: string }) {
  const rate = await Rate.findOne({ date });
  if (!rate) throw notFound(`No rate saved for ${date}. Save a rate first, then test.`);
  if (rate.status === 'cancelled') throw conflict('This rate was cancelled. Save it again before testing.');
  if (!cfg.DRY_RUN) throw new HttpError(503, 'Live test sends need the WhatsApp publisher (Phase 4). Keep DRY_RUN=true for now.');

  const channel = 'wa_admin' as const;
  if ((CUSTOMER_CHANNELS as readonly string[]).includes(channel)) throw new Error('Test send must never use a customer channel');

  const rendered = await previewSavedRate(storage, date);
  const delivery = await Delivery.create({
    rateId: rate._id, date, channel, trigger: 'test', status: 'test',
    idempotencyKey: deliveryIdempotencyKey(date, channel, 'test', crypto.randomUUID()),
    recipient: admin.email, dryRun: true, requestedBy: admin.email, attempts: 1,
    creativeUrls: { feed: rendered.feedUrl, story: rendered.storyUrl }, caption: rendered.caption,
    rateSnapshot: { k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities },
  });
  logger.info({ deliveryId: String(delivery._id), date, channel, recipient: admin.email, feed: rendered.feedUrl, story: rendered.storyUrl },
    `DRY_RUN test send – would send today's rate to admin ${admin.email} only (no customers)`);
  return { delivery: deliveryToDTO(delivery), rendered, dryRun: true, rateStatus: rate.status };
}
