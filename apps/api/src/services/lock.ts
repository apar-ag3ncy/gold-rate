import crypto from 'node:crypto';
import { JobLock } from '../models';

/**
 * Mongo job lock: atomically claims `name` if it is free or expired. Returns null when another worker holds it.
 * The lock is released when `fn` finishes (or expires after ttlMs if the process dies).
 */
export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const owner = crypto.randomUUID();
  const now = new Date();
  const claimed = await JobLock.findOneAndUpdate(
    { name, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }] },
    { $set: { lockedUntil: new Date(now.getTime() + ttlMs), owner } },
    { new: true, upsert: true },
  ).catch((e: any) => { if (e?.code === 11000) return null; throw e; });
  if (!claimed || claimed.owner !== owner) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await JobLock.updateOne({ name, owner }, { $set: { lockedUntil: new Date(0) } });
  }
}
