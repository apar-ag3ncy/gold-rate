import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@chheda/shared';
import { findSession, SESSION_COOKIE } from '../lib/auth';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser { id: string; email: string; name: string; role: Role }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const found = await findSession(req.cookies?.[SESSION_COOKIE]);
    if (found) req.user = { id: String(found.user._id), email: found.user.email, name: found.user.name, role: found.user.role as Role };
    next();
  } catch (e) { next(e); }
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => (req.user ? next() : next(unauthorized()));

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  return roles.includes(req.user.role) ? next() : next(forbidden());
};

/**
 * CSRF defence for cookie auth: state-changing requests must carry a custom header
 * (browsers can't add it cross-site without CORS) and, if an Origin is sent, it must match.
 */
export const csrfGuard = (allowedOrigin: string) => (req: Request, _res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'chheda-web') return next(forbidden('Missing CSRF header'));
  const origin = req.get('origin');
  if (origin && origin !== allowedOrigin) return next(forbidden('Bad origin'));
  next();
};
