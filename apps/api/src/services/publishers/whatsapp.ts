import { buildWhatsAppBodyParams, deliveryIdempotencyKey, type WhatsAppTemplateSettings } from '@chheda/shared';
import { logger } from '../../lib/logger';
import { decrypt } from '../../lib/crypto';
import { Delivery, Subscriber } from '../../models';
import { MetaApiError, MetaClient, PublishError } from '../meta/client';
import type { PublishPayload, PublishResult, Publisher } from './index';

export interface WhatsAppCreds { phoneNumberId: string; accessToken: string }
export interface WhatsAppOptions { concurrency?: number; delayMs?: number; sleep?: (ms: number) => Promise<void>; dryRun?: boolean; maxAttemptsPerRecipient?: number }
export interface WaBatchStats { total: number; sent: number; failed: number; skipped: number }

// Cloud API error codes that mean "this recipient will never work" → subscriber marked invalid
const PERMANENT_RECIPIENT_CODES = new Set([131026, 131030, 131047, 131051, 131052, 131053, 100]);

/**
 * WhatsApp Cloud API: the approved daily-rate template (image header = feed image, body = exact values) to every ACTIVE subscriber.
 * One delivery row per subscriber (key date:wa_cloud:<phoneHash>) – a retry never messages anyone twice.
 * The channel is "success" when the batch completes; per-recipient results live in stats + rows.
 */
export class WhatsAppPublisher implements Publisher {
  readonly channel = 'wa_customers' as const;
  constructor(private readonly client: MetaClient, private readonly creds: WhatsAppCreds, private readonly tpl: WhatsAppTemplateSettings, private readonly o: WhatsAppOptions = {}) {}

  /** Per-recipient idempotency key */
  static recipientKey = (date: string, phoneHash: string) => `${date}:wa_cloud:${phoneHash}`;

  async publish(p: PublishPayload & { rateId?: unknown }): Promise<PublishResult & { stats: WaBatchStats }> {
    const subs = await Subscriber.find({ status: 'active' }).select('+phoneEnc').lean();
    const stats: WaBatchStats = { total: subs.length, sent: 0, failed: 0, skipped: 0 };
    const params = buildWhatsAppBodyParams({ date: p.date, ...p.rate }, this.tpl.includeExtrasParam);
    const sleep = this.o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxAttempts = this.o.maxAttemptsPerRecipient ?? 3;
    const concurrency = this.o.concurrency ?? 5;
    const delayMs = this.o.delayMs ?? 100;

    const sendOne = async (sub: any) => {
      const key = WhatsAppPublisher.recipientKey(p.date, sub.phoneHash);
      const row = (await Delivery.findOne({ idempotencyKey: key })) ?? await Delivery.create({
        rateId: p.rateId, date: p.date, channel: 'wa_customers', trigger: 'cron', status: 'queued', idempotencyKey: key,
        recipientHash: sub.phoneHash, recipientMasked: sub.phoneMasked, dryRun: !!this.o.dryRun, attempts: 0,
      });
      if (row.status === 'success') { stats.skipped++; return; }
      if (row.status === 'failed' && row.retryable === false) { stats.failed++; return; }
      if ((row.attempts ?? 0) >= maxAttempts) { stats.failed++; return; }
      row.attempts = (row.attempts ?? 0) + 1;
      try {
        const to = decrypt(sub.phoneEnc).replace(/^\+/, '');
        let messageId: string;
        if (this.o.dryRun) {
          messageId = `dry-run:wa:${p.date}:${sub.phoneHash.slice(0, 8)}`;
        } else {
          const res = await this.client.post<{ messages?: { id: string }[] }>(`${this.creds.phoneNumberId}/messages`, {
            messaging_product: 'whatsapp', to, type: 'template',
            template: {
              name: this.tpl.templateName, language: { code: this.tpl.templateLanguage },
              components: [
                { type: 'header', parameters: [{ type: 'image', image: { link: p.feedUrl } }] },
                { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
              ],
            },
          }, this.creds.accessToken);
          messageId = res.messages?.[0]?.id ?? '';
          if (!messageId) throw new PublishError('WhatsApp did not return a message id', true);
        }
        row.set({ status: 'success', externalId: messageId, waStatus: 'accepted', error: undefined, metaErrorCode: undefined, metaErrorMessage: undefined });
        await row.save();
        await Subscriber.updateOne({ _id: sub._id }, { lastDeliveryStatus: 'sent', lastDeliveryAt: new Date(), lastError: undefined });
        stats.sent++;
      } catch (e: any) {
        const code = e instanceof MetaApiError ? e.code : undefined;
        const permanent = e instanceof MetaApiError ? !e.retryable || PERMANENT_RECIPIENT_CODES.has(code ?? -1) : e instanceof PublishError ? !e.retryable : false;
        const exhausted = row.attempts >= maxAttempts;
        row.set({ status: permanent || exhausted ? 'failed' : 'queued', error: e?.message ?? String(e), metaErrorCode: code, metaErrorMessage: e?.message, retryable: !permanent });
        await row.save();
        await Subscriber.updateOne({ _id: sub._id }, { lastDeliveryStatus: 'failed', lastDeliveryAt: new Date(), lastError: e?.message, ...(permanent && PERMANENT_RECIPIENT_CODES.has(code ?? -1) ? { status: 'invalid' } : {}) });
        logger.warn({ recipient: sub.phoneMasked, code, permanent }, `WhatsApp send failed: ${e?.message}`);
        stats.failed++;
      }
    };

    // bounded concurrency + throttle
    let i = 0;
    const workers = Array.from({ length: Math.min(concurrency, subs.length || 1) }, async () => {
      while (i < subs.length) {
        const sub = subs[i++];
        await sendOne(sub);
        if (delayMs) await sleep(delayMs);
      }
    });
    await Promise.all(workers);

    logger.info({ date: p.date, ...stats, dryRun: !!this.o.dryRun }, 'WhatsApp batch complete');
    return { externalId: `wa-batch:${p.date}`, detail: `sent ${stats.sent}/${stats.total}, failed ${stats.failed}, skipped ${stats.skipped}`, stats };
  }
}
