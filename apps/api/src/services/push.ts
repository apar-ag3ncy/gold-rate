import type { Config } from '../config';
import { logger } from '../lib/logger';
import { PushSubscription } from '../models';

export interface PushPayload { title: string; body: string; url?: string; tag?: string }
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
/** Injectable transport so tests never touch the push services. Throw {statusCode: 404|410} for a dead subscription. */
export type PushTransport = (sub: PushSub, payload: string, opts: { vapid: { subject: string; publicKey: string; privateKey: string }; ttl: number }) => Promise<void>;

let transport: PushTransport | null = null;
export function setPushTransport(t: PushTransport | null) { transport = t; }

async function defaultTransport(): Promise<PushTransport> {
  const webpush = (await import('web-push')).default;
  return async (sub, payload, { vapid, ttl }) => {
    await webpush.sendNotification(sub, payload, { vapidDetails: vapid, TTL: ttl });
  };
}

export function pushConfigured(cfg: Config) { return !!(cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY); }

export async function saveSubscription(sub: PushSub, user: { id: string; email: string; role: string }, userAgent?: string) {
  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { $set: { keys: sub.keys, userId: user.id, userEmail: user.email, role: user.role, userAgent, failures: 0 } },
    { upsert: true, new: true },
  );
  return { id: String(doc._id) };
}

export async function removeSubscription(endpoint: string, userId: string) {
  const r = await PushSubscription.deleteOne({ endpoint, userId });
  return r.deletedCount > 0;
}

/** Send to every subscription of the given roles. Dead endpoints (404/410) are deleted. Returns counts. */
export async function sendPush(cfg: Config, roles: string[], payload: PushPayload, ttlSec = 3600) {
  const subs = await PushSubscription.find({ role: { $in: roles } }).lean();
  const result = { targeted: subs.length, sent: 0, failed: 0, removed: 0, skipped: false };
  if (!subs.length) return result;
  if (!pushConfigured(cfg)) {
    logger.info({ roles, title: payload.title, targeted: subs.length }, 'push skipped – VAPID keys not configured');
    return { ...result, skipped: true };
  }
  const send = transport ?? await defaultTransport();
  const vapid = { subject: cfg.VAPID_SUBJECT, publicKey: cfg.VAPID_PUBLIC_KEY!, privateKey: cfg.VAPID_PRIVATE_KEY! };
  const body = JSON.stringify({ ...payload, url: payload.url ?? `${cfg.WEB_PUBLIC_URL}/staff` });
  await Promise.all(subs.map(async (s) => {
    try {
      await send({ endpoint: s.endpoint, keys: s.keys as any }, body, { vapid, ttl: ttlSec });
      await PushSubscription.updateOne({ _id: s._id }, { lastUsedAt: new Date(), failures: 0 });
      result.sent++;
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      if (status === 404 || status === 410) { await PushSubscription.deleteOne({ _id: s._id }); result.removed++; }
      else { await PushSubscription.updateOne({ _id: s._id }, { $inc: { failures: 1 } }); result.failed++; logger.warn({ status, err: e?.message }, 'push failed'); }
    }
  }));
  logger.info({ roles, title: payload.title, ...result }, 'push sent');
  return result;
}
