import type { IntegrationChannel } from '@chheda/shared';
import type { Config } from '../config';
import { decrypt, encrypt, tail } from '../lib/crypto';
import { logger } from '../lib/logger';
import { Integration } from '../models';
import { MetaApiError, MetaClient, type FetchLike } from './meta/client';
import { raiseAlert } from './alerts';

/** What the browser may see. Never the token. */
export function integrationToDTO(i: any) {
  return {
    channel: i.channel, status: i.status ?? 'not_configured', hasToken: !!i.tokenTail, tokenTail: i.tokenTail,
    accountId: i.accountId, phoneNumberId: i.phoneNumberId, displayName: i.displayName,
    expiresAt: i.expiresAt, lastHealthCheck: i.lastHealthCheck, lastError: i.lastError, updatedAt: i.updatedAt, updatedBy: i.updatedBy,
  };
}

export async function listIntegrations() {
  const rows = await Integration.find().lean();
  return (['instagram', 'whatsapp'] as const).map((c) => integrationToDTO(rows.find((r) => r.channel === c) ?? { channel: c }));
}

export interface SaveIntegrationInput { accessToken?: string; accountId?: string; phoneNumberId?: string; expiresAt?: Date | null }

/** Write-only credentials. Token is encrypted (AES-256-GCM) before it touches the database. */
export async function saveIntegration(channel: IntegrationChannel, input: SaveIntegrationInput, by: string) {
  const doc = (await Integration.findOne({ channel }).select('+encryptedToken')) ?? new Integration({ channel });
  if (input.accessToken) doc.set({ encryptedToken: encrypt(input.accessToken), tokenTail: tail(input.accessToken) });
  if (input.accountId !== undefined) doc.accountId = input.accountId || undefined;
  if (input.phoneNumberId !== undefined) doc.phoneNumberId = input.phoneNumberId || undefined;
  if (input.expiresAt !== undefined) doc.expiresAt = input.expiresAt ?? undefined;
  doc.set({ updatedBy: by, status: doc.tokenTail ? (doc.status === 'connected' ? 'connected' : 'not_configured') : 'not_configured', lastError: undefined });
  await doc.save();
  return integrationToDTO(doc);
}

export async function removeIntegration(channel: IntegrationChannel) {
  await Integration.deleteOne({ channel });
}

export type Creds =
  | { ok: true; token: string; accountId: string; phoneNumberId: string }
  | { ok: false; reason: string };

/** Decrypted credentials for a publisher – only when the integration is connected. */
export async function getIntegrationCreds(channel: IntegrationChannel): Promise<Creds> {
  const i = await Integration.findOne({ channel }).select('+encryptedToken').lean();
  if (!i?.encryptedToken) return { ok: false, reason: `${channel} is not connected (no access token saved on Settings → Connections)` };
  if (i.status !== 'connected') return { ok: false, reason: `${channel} connection is ${i.status}${i.lastError ? `: ${i.lastError}` : ''} – run "Test connection"` };
  if (channel === 'instagram' && !i.accountId) return { ok: false, reason: 'Instagram user id missing' };
  if (channel === 'whatsapp' && !i.phoneNumberId) return { ok: false, reason: 'WhatsApp phone number id missing' };
  return { ok: true, token: decrypt(i.encryptedToken), accountId: i.accountId ?? '', phoneNumberId: i.phoneNumberId ?? '' };
}

/**
 * "Test connection": one harmless read per channel. Also asks Meta how long the token lives (debug_token) when
 * META_APP_ID/SECRET are configured. Updates status / displayName / expiresAt / lastHealthCheck.
 */
export async function testConnection(channel: IntegrationChannel, cfg: Config, fetchFn?: FetchLike) {
  const doc = await Integration.findOne({ channel }).select('+encryptedToken');
  if (!doc?.encryptedToken) return { ok: false, error: 'No access token saved yet.' };
  const client = new MetaClient(cfg, fetchFn);
  const token = decrypt(doc.encryptedToken);
  try {
    let displayName = '';
    if (channel === 'instagram') {
      if (!doc.accountId) throw new Error('Instagram user id is missing');
      const me = await client.get<{ id: string; username?: string }>(doc.accountId, { fields: 'id,username' }, token);
      displayName = me.username ? `@${me.username}` : me.id;
    } else {
      if (!doc.phoneNumberId) throw new Error('Phone number id is missing');
      const ph = await client.get<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(doc.phoneNumberId, { fields: 'display_phone_number,verified_name,quality_rating' }, token);
      displayName = [ph.verified_name, ph.display_phone_number, ph.quality_rating && `quality ${ph.quality_rating}`].filter(Boolean).join(' · ');
    }
    let expiresAt: Date | undefined = doc.expiresAt ?? undefined;
    if (cfg.META_APP_ID && cfg.META_APP_SECRET) {
      try {
        const dbg = await client.get<{ data?: { expires_at?: number; is_valid?: boolean; error?: { message: string } } }>('debug_token', { input_token: token }, `${cfg.META_APP_ID}|${cfg.META_APP_SECRET}`);
        if (dbg.data?.is_valid === false) throw new Error(`Token invalid: ${dbg.data.error?.message ?? 'unknown'}`);
        expiresAt = dbg.data?.expires_at ? new Date(dbg.data.expires_at * 1000) : undefined; // 0 = never expires
      } catch (e) { if (!(e instanceof MetaApiError)) throw e; logger.warn({ err: e.message }, 'debug_token failed – expiry unknown'); }
    }
    doc.set({ status: 'connected', displayName, expiresAt, lastHealthCheck: new Date(), lastError: undefined });
    await doc.save();
    return { ok: true, displayName, expiresAt };
  } catch (e: any) {
    doc.set({ status: 'error', lastHealthCheck: new Date(), lastError: e?.message ?? String(e) });
    await doc.save();
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Daily: re-test every configured connection; alert on invalid tokens and on tokens expiring within 7 days. */
export async function checkIntegrationsHealth(cfg: Config, date: string, fetchFn?: FetchLike): Promise<string[]> {
  const problems: string[] = [];
  for (const channel of ['instagram', 'whatsapp'] as const) {
    const i = await Integration.findOne({ channel }).select('+encryptedToken').lean();
    if (!i?.encryptedToken) { if (!cfg.DRY_RUN) problems.push(`${channel} is not connected`); continue; }
    const r = await testConnection(channel, cfg, fetchFn);
    if (!r.ok) {
      problems.push(`${channel} token invalid: ${r.error}`);
      await raiseAlert({ type: 'token_expiring', severity: 'critical', date, dedupeKey: `token_invalid:${channel}:${date}`, message: `${channel} connection failed: ${r.error}. Update the token on Settings → Connections.` });
      continue;
    }
    if (r.expiresAt) {
      const days = (r.expiresAt.getTime() - Date.now()) / 86_400_000;
      if (days <= 7) {
        problems.push(`${channel} token expires in ${Math.max(0, Math.floor(days))} day(s)`);
        await raiseAlert({ type: 'token_expiring', severity: days <= 1 ? 'critical' : 'warning', date, dedupeKey: `token_expiring:${channel}:${date}`,
          message: `${channel} access token expires on ${r.expiresAt.toISOString().slice(0, 10)}. Generate a new token and save it on Settings → Connections.` });
      }
    }
  }
  return problems;
}
