import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config';
import { createSession, destroySession, verifyLogin, SESSION_COOKIE } from '../lib/auth';
import { HttpError, unauthorized } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { AuditLog } from '../models';

// `email` may be an email address or a plain username (stored lowercase in the same field)
const loginSchema = z.object({ email: z.string().trim().min(1, 'Required').max(200), password: z.string().min(1, 'Required').max(200) });

export function authRouter(cfg: Config) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: true, legacyHeaders: false });

  r.post('/login', limiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const result = await verifyLogin(email, password);
    if (!result.ok) {
      await AuditLog.create({ action: 'login_failed', entity: 'user', userEmail: email, ip: req.ip });
      if (result.reason === 'locked') throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
      throw unauthorized('Incorrect email or password');
    }
    const { token, expiresAt } = await createSession(result.user._id, cfg.SESSION_TTL_HOURS, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: cfg.NODE_ENV === 'production', sameSite: 'strict', expires: expiresAt, path: '/',
    });
    await AuditLog.create({ action: 'login', entity: 'user', entityId: String(result.user._id), userId: result.user._id, userEmail: result.user.email, ip: req.ip });
    res.json({ user: { id: String(result.user._id), email: result.user.email, name: result.user.name, role: result.user.role } });
  });

  r.post('/logout', async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  return r;
}
