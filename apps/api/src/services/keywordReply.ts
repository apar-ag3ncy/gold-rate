import { buildWhatsAppBodyParams, deliveryIdempotencyKey, istDate, matchesRateKeyword, DEFAULT_KEYWORD_REPLY } from '@chheda/shared';
import type { Config } from '../config';
import { lookupHash } from '../lib/crypto';
import { logger } from '../lib/logger';
import { Delivery, Rate, getSettings } from '../models';
import { raiseAlert } from './alerts';
import { getIntegrationCreds } from './integrations';
import { MetaClient, type FetchLike } from './meta/client';
import { previewSavedRate } from './preview';
import type { StorageAdapter } from './storage';

/** Meta lets a business reply free-form for 24 h after the customer's last message (WhatsApp + Instagram). */
export const REPLY_WINDOW_MS = 24 * 3600_000;

export interface InboundMessage {
  channel: 'whatsapp' | 'instagram';
  /** WhatsApp: E.164 phone. Instagram: Instagram-scoped user id (IGSID). */
  senderId: string;
  messageId: string;
  text: string | undefined;
  /** when the customer sent it (epoch ms) */
  sentAt: number;
}
export type KeywordOutcome =
  | { action: 'no_match' } | { action: 'feature_off' } | { action: 'duplicate' } | { action: 'limit_reached'; deliveryId: string }
  | { action: 'replied'; kind: 'rate' | 'not_ready'; mode: 'freeform' | 'template'; deliveryId: string; externalId?: string }
  | { action: 'skipped'; reason: string; deliveryId: string }
  | { action: 'failed'; error: string; deliveryId: string };

export interface KeywordDeps { cfg: Config; storage: StorageAdapter; fetchFn?: FetchLike; now?: Date }

const mask = (m: InboundMessage) => m.channel === 'whatsapp' ? `${m.senderId.slice(0, 3)}${'•'.repeat(Math.max(0, m.senderId.length - 7))}${m.senderId.slice(-4)}` : `ig:…${m.senderId.slice(-4)}`;

/**
 * "RATE" keyword auto-reply. Only exact trigger matches get a reply; replies are idempotent per message id, limited per sender
 * per day, and NEVER contain an old rate – if today's rate isn't approved the configurable "check back" text is sent instead.
 */
export async function handleKeywordMessage(m: InboundMessage, deps: KeywordDeps): Promise<KeywordOutcome> {
  const now = deps.now ?? new Date();
  const s = await getSettings();
  const kr = { triggers: s.keywordReply?.triggers?.length ? [...s.keywordReply.triggers] : DEFAULT_KEYWORD_REPLY.triggers, maxPerSenderPerDay: s.keywordReply?.maxPerSenderPerDay ?? DEFAULT_KEYWORD_REPLY.maxPerSenderPerDay, notReadyMessage: s.keywordReply?.notReadyMessage ?? DEFAULT_KEYWORD_REPLY.notReadyMessage };
  if (!matchesRateKeyword(m.text, kr.triggers)) return { action: 'no_match' };
  if (s.channels?.rateKeywordReply === false) return { action: 'feature_off' };

  const date = istDate(now);
  const channel = m.channel === 'whatsapp' ? 'wa_keyword' as const : 'ig_keyword' as const;
  const key = deliveryIdempotencyKey(date, channel, 'keyword', `${m.channel}:${m.messageId}`);
  const recipientHash = lookupHash(`${m.channel}:${m.senderId}`);
  const recipientMasked = mask(m);

  // idempotent per incoming message id
  const existing = await Delivery.findOne({ idempotencyKey: key }).lean();
  if (existing) return { action: 'duplicate' };
  const row = await Delivery.create({ date, channel, trigger: 'keyword', status: 'queued', idempotencyKey: key, recipientHash, recipientMasked, dryRun: deps.cfg.DRY_RUN, attempts: 0 })
    .catch((e: any) => { if (e?.code === 11000) return null; throw e; });
  if (!row) return { action: 'duplicate' };

  // per-sender daily limit (successful replies only)
  const sentToday = await Delivery.countDocuments({ date, channel, trigger: 'keyword', recipientHash, status: 'success' });
  if (sentToday >= kr.maxPerSenderPerDay) {
    await row.set({ status: 'skipped', error: `Daily limit of ${kr.maxPerSenderPerDay} auto-replies reached for this sender` }).save();
    return { action: 'limit_reached', deliveryId: String(row._id) };
  }

  // content: today's APPROVED/SENT rate or the "not ready" text – never an older date
  const rate = await Rate.findOne({ date, status: { $in: ['approved', 'sent'] } }).lean();
  let kind: 'rate' | 'not_ready' = 'not_ready';
  let creative: { feedUrl: string; caption: string } | null = null;
  if (rate) {
    try { const r = await previewSavedRate(deps.storage, date); creative = { feedUrl: r.feedUrl, caption: r.caption }; kind = 'rate'; }
    catch (e: any) { logger.warn({ err: e?.message }, 'keyword reply: creative failed, sending not-ready text'); }
  }
  const windowOpen = now.getTime() - m.sentAt < REPLY_WINDOW_MS;
  row.set({ rateSnapshot: rate ? { k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities } : undefined, caption: creative?.caption ?? kr.notReadyMessage, creativeUrls: creative ? { feed: creative.feedUrl } : undefined });
  row.attempts = 1;

  try {
    let externalId: string | undefined;
    let mode: 'freeform' | 'template' = 'freeform';
    if (deps.cfg.DRY_RUN) {
      externalId = `dry-run:${channel}:${m.messageId}`;
      mode = windowOpen ? 'freeform' : 'template';
      logger.info({ channel, to: recipientMasked, kind, mode }, 'DRY_RUN keyword reply (nothing sent)');
    } else if (m.channel === 'whatsapp') {
      const creds = await getIntegrationCreds('whatsapp');
      if (!creds.ok) throw new Error(creds.reason);
      const client = new MetaClient(deps.cfg, deps.fetchFn);
      const to = m.senderId.replace(/^\+/, '');
      if (windowOpen) {
        const body = creative
          ? { messaging_product: 'whatsapp', to, type: 'image', image: { link: creative.feedUrl, caption: creative.caption } }
          : { messaging_product: 'whatsapp', to, type: 'text', text: { body: kr.notReadyMessage } };
        externalId = (await client.post<{ messages?: { id: string }[] }>(`${creds.phoneNumberId}/messages`, body, creds.token)).messages?.[0]?.id;
      } else {
        mode = 'template';
        if (!creative || !rate) { await row.set({ status: 'skipped', error: 'Reply window closed and no approved rate to send as a template' }).save(); return { action: 'skipped', reason: 'window_closed_not_ready', deliveryId: String(row._id) }; }
        const params = buildWhatsAppBodyParams({ date, k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities as any }, !!s.whatsapp?.includeExtrasParam);
        externalId = (await client.post<{ messages?: { id: string }[] }>(`${creds.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp', to, type: 'template',
          template: { name: s.whatsapp?.templateName, language: { code: s.whatsapp?.templateLanguage }, components: [
            { type: 'header', parameters: [{ type: 'image', image: { link: creative.feedUrl } }] },
            { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
          ] },
        }, creds.token)).messages?.[0]?.id;
      }
    } else {
      // Instagram Messaging API (official): POST /{ig-user-id}/messages, inside the 24 h standard messaging window
      if (!windowOpen) { await row.set({ status: 'skipped', error: 'Instagram reply window (24 h) has closed' }).save(); return { action: 'skipped', reason: 'window_closed', deliveryId: String(row._id) }; }
      const creds = await getIntegrationCreds('instagram');
      if (!creds.ok) throw new Error(creds.reason);
      const client = new MetaClient(deps.cfg, deps.fetchFn);
      const recipient = { id: m.senderId };
      if (creative) {
        await client.post(`${creds.accountId}/messages`, { recipient, message: { attachment: { type: 'image', payload: { url: creative.feedUrl } } } }, creds.token);
        externalId = (await client.post<{ message_id?: string }>(`${creds.accountId}/messages`, { recipient, message: { text: creative.caption } }, creds.token)).message_id;
      } else {
        externalId = (await client.post<{ message_id?: string }>(`${creds.accountId}/messages`, { recipient, message: { text: kr.notReadyMessage } }, creds.token)).message_id;
      }
    }
    await row.set({ status: 'success', externalId, error: undefined }).save();
    return { action: 'replied', kind, mode, deliveryId: String(row._id), externalId };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await row.set({ status: 'failed', error: msg, metaErrorCode: e?.code, retryable: false }).save();
    logger.warn({ channel, to: recipientMasked, err: msg }, 'keyword reply failed');
    await raiseAlert({ type: 'keyword_reply_failed', severity: 'warning', date, dedupeKey: `keyword_reply_failed:${date}:${channel}`,
      message: `A "${m.text?.trim()}" auto-reply on ${m.channel} failed: ${msg}. Check Settings → Connections.` }).catch(() => {});
    return { action: 'failed', error: msg, deliveryId: String(row._id) };
  }
}

/** Dashboard: today's count + the last N replies (masked senders). */
export async function keywordReplyLog(limit = 50) {
  const date = istDate();
  const [today, items] = await Promise.all([
    Delivery.countDocuments({ date, trigger: 'keyword', status: 'success' }),
    Delivery.find({ trigger: 'keyword' }).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  return { date, todayCount: today, items: items.map((d) => ({ id: String(d._id), channel: d.channel, status: d.status, recipientMasked: d.recipientMasked, kind: d.creativeUrls?.feed ? 'rate' : 'not_ready', error: d.error, dryRun: d.dryRun, createdAt: d.createdAt })) };
}
