import crypto from 'node:crypto';
import { classifyKeyword } from '@chheda/shared';
import type { Config } from '../config';
import { timingSafeEqualStr } from '../lib/crypto';
import { logger } from '../lib/logger';
import { Delivery, WebhookEvent } from '../models';
import { MetaClient, type FetchLike } from './meta/client';
import { getIntegrationCreds } from './integrations';
import { optIn, optOut } from './subscribers';

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(app secret, raw body). Timing-safe compare. */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string | undefined): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return timingSafeEqualStr(expected, header);
}

const WA_STATUS_RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 9 };

/** Store once per eventKey; returns null when we have already seen it. */
async function remember(source: 'whatsapp' | 'instagram', eventKey: string, kind: string, payload: unknown) {
  try { return await WebhookEvent.create({ source, eventKey, kind, payload }); }
  catch (e: any) { if (e?.code === 11000) return null; throw e; }
}

const JOIN_REPLY = "You're subscribed to Chheda Jewellers' daily gold rate. Reply STOP anytime to unsubscribe.";
const STOP_REPLY = "You've been unsubscribed from Chheda Jewellers' gold rate updates. Reply JOIN to subscribe again.";

/** WhatsApp Cloud API webhook payload → delivery statuses + JOIN/STOP. Idempotent on message/status id. */
export async function processWhatsAppEvent(body: any, cfg: Config, fetchFn?: FetchLike) {
  const summary = { statuses: 0, messages: 0, duplicates: 0, joins: 0, stops: 0, rateKeyword: 0 };
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const st of v.statuses ?? []) {
        const key = `wa:status:${st.id}:${st.status}`;
        if (!(await remember('whatsapp', key, 'status', st))) { summary.duplicates++; continue; }
        summary.statuses++;
        const d = await Delivery.findOne({ externalId: st.id });
        if (!d) continue;
        const rank = WA_STATUS_RANK[st.status] ?? 0;
        if (rank >= (WA_STATUS_RANK[d.waStatus ?? 'accepted'] ?? 0)) {
          d.set({ waStatus: st.status, waStatusAt: new Date(Number(st.timestamp) * 1000 || Date.now()) });
          if (st.status === 'failed') {
            const err = st.errors?.[0];
            d.set({ status: 'failed', error: err?.title ?? err?.message ?? 'failed', metaErrorCode: err?.code, metaErrorMessage: err?.error_data?.details ?? err?.message, retryable: false });
          }
          await d.save();
        }
        await WebhookEvent.updateOne({ eventKey: key }, { processedAt: new Date() });
      }
      for (const m of v.messages ?? []) {
        const key = `wa:message:${m.id}`;
        if (!(await remember('whatsapp', key, 'message', { from: m.from, type: m.type, id: m.id }))) { summary.duplicates++; continue; }
        summary.messages++;
        const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : '';
        const kw = classifyKeyword(text);
        const from = `+${String(m.from).replace(/^\+/, '')}`;
        if (kw === 'join') { await optIn(from, 'whatsapp_join'); summary.joins++; await replyText(from, JOIN_REPLY, cfg, fetchFn); }
        else if (kw === 'stop') { await optOut(from); summary.stops++; await replyText(from, STOP_REPLY, cfg, fetchFn); }
        else if (kw === 'rate') { summary.rateKeyword++; logger.info('RATE keyword received – auto-reply arrives in Phase 5'); }
        await WebhookEvent.updateOne({ eventKey: key }, { processedAt: new Date() });
      }
    }
  }
  return summary;
}

/** Free-form reply inside the 24-hour customer-service window (the customer just messaged us). */
async function replyText(to: string, text: string, cfg: Config, fetchFn?: FetchLike) {
  if (cfg.DRY_RUN) { logger.info({ to: `${to.slice(0, 3)}…${to.slice(-4)}` }, `DRY_RUN reply: ${text}`); return; }
  const creds = await getIntegrationCreds('whatsapp');
  if (!creds.ok) { logger.warn(creds.reason); return; }
  const client = new MetaClient(cfg, fetchFn);
  await client.post(`${creds.phoneNumberId}/messages`, { messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body: text } }, creds.token)
    .catch((e) => logger.warn({ err: e.message }, 'reply failed'));
}

/** Instagram webhooks (messaging → Phase 5). Stored + deduplicated only. */
export async function processInstagramEvent(body: any) {
  let stored = 0, duplicates = 0;
  for (const entry of body?.entry ?? []) {
    const msgs = entry.messaging ?? entry.changes ?? [];
    for (const [i, m] of msgs.entries()) {
      const key = `ig:${entry.id}:${m.message?.mid ?? m.timestamp ?? entry.time}:${i}`;
      if (await remember('instagram', key, m.message ? 'message' : 'other', m)) stored++; else duplicates++;
    }
  }
  return { stored, duplicates };
}
