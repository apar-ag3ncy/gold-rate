import crypto from 'node:crypto';
import argon2 from 'argon2';
import { Session, User } from '../models';

export const SESSION_COOKIE = 'chheda_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Password needs upper-case, lower-case and a number';
  return null;
}

// Constant-time-ish behaviour for unknown users: still run a hash verify.
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$0y4H0cM7wqcfb3Zp5nSH3QCrFfT1vVXg6v3+0Ym2P3U';

export async function verifyLogin(email: string, password: string) {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
  if (!user) { await argon2.verify(DUMMY_HASH, password).catch(() => false); return { ok: false as const, reason: 'invalid' }; }
  if (user.disabled) return { ok: false as const, reason: 'invalid' };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false as const, reason: 'locked' };
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    user.failedLogins = (user.failedLogins ?? 0) + 1;
    if (user.failedLogins >= MAX_FAILED) { user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000); user.failedLogins = 0; }
    await user.save();
    return { ok: false as const, reason: 'invalid' };
  }
  user.failedLogins = 0; user.lockedUntil = undefined; user.lastLoginAt = new Date();
  await user.save();
  return { ok: true as const, user };
}

export async function createSession(userId: unknown, ttlHours: number, meta: { ip?: string; userAgent?: string }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await Session.create({ tokenHash: sha256(token), userId, expiresAt, ...meta });
  return { token, expiresAt };
}

export async function findSession(token: string | undefined) {
  if (!token) return null;
  const s = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  if (!s) return null;
  const user = await User.findById(s.userId);
  if (!user || user.disabled) return null;
  return { session: s, user };
}

export const destroySession = (token: string) => Session.deleteOne({ tokenHash: sha256(token) });
