import crypto from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import type { Config } from './config';
import { logger } from './lib/logger';
import { HttpError } from './lib/errors';
import { csrfGuard, loadUser, setDevAutoLogin } from './middleware/auth';
import { authRouter } from './routes/auth';
import { ratesRouter } from './routes/rates';
import { settingsRouter } from './routes/settings';
import { auditRouter } from './routes/audit';
import { previewRouter } from './routes/preview';
import { sendRouter } from './routes/send';
import { deliveriesRouter } from './routes/deliveries';
import { alertsRouter } from './routes/alerts';
import { integrationsRouter } from './routes/integrations';
import { subscribersRouter } from './routes/subscribers';
import { webhooksRouter } from './routes/webhooks';
import { staffRouter } from './routes/staff';
import { usersRouter } from './routes/users';
import { ibjaRouter } from './routes/ibja';
import { setAlertNotifier } from './services/alerts';
import { setWebhookStorage } from './services/webhooks';
import { createStorage } from './services/storage';

export let sentryCapture: ((err: unknown, ctx?: Record<string, unknown>) => void) | null = null;
export function setSentryCapture(fn: typeof sentryCapture) { sentryCapture = fn; }

export interface AppDeps { /** test seam: every outbound HTTP call from routes goes through this */ fetchFn?: (url: string, init?: RequestInit) => Promise<Response> }

export function createApp(cfg: Config, deps: AppDeps = {}) {
  const app = express();
  const storage = createStorage(cfg);
  setAlertNotifier(cfg);
  setWebhookStorage(storage);
  setDevAutoLogin(cfg.NODE_ENV !== 'production' && cfg.DEV_AUTO_LOGIN_EMAIL ? cfg.DEV_AUTO_LOGIN_EMAIL : null);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  // request id: reuse an upstream id (Nginx / Vercel) or mint one; echoed back so support tickets can quote it
  app.use(pinoHttp({
    logger, autoLogging: { ignore: (req) => req.url === '/health' },
    genReqId: (req, res) => { const id = (req.headers['x-request-id'] as string) || crypto.randomUUID(); res.setHeader('x-request-id', id); return id; },
    customProps: (req) => ({ user: (req as any).user?.email }),
  }));
  // keep the raw bytes so webhook signatures can be verified
  app.use(express.json({ limit: '100kb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ ok: db, db: db ? 'up' : 'down', dryRun: cfg.DRY_RUN });
  });

  // Rendered creatives (local driver). Public by design – Instagram must be able to fetch them (Phase 4).
  if (storage.driver === 'local') {
    app.use('/media', (_req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next(); },
      express.static(cfg.MEDIA_DIR, { index: false, dotfiles: 'deny', immutable: true, maxAge: '365d' }),
      (_req: express.Request, res: express.Response) => { res.status(404).json({ error: 'Media not found' }); });
  }

  // Meta webhooks: signature-verified, no session / CSRF (Meta cannot send either)
  app.use('/api/v1/webhooks', rateLimit({ windowMs: 60_000, limit: cfg.NODE_ENV === 'test' ? 10_000 : 600, standardHeaders: true, legacyHeaders: false }), webhooksRouter(cfg));

  const api = express.Router();
  api.use(csrfGuard(cfg.WEB_ORIGIN));
  api.use(loadUser);
  api.use('/auth', authRouter(cfg));
  api.use('/rates', ratesRouter());
  api.use('/settings', settingsRouter());
  api.use('/audit', auditRouter());
  api.use('/preview', previewRouter(cfg, storage));
  api.use('/send', sendRouter(cfg, storage));
  api.use('/deliveries', deliveriesRouter());
  api.use('/alerts', alertsRouter());
  api.use('/integrations', integrationsRouter(cfg));
  api.use('/subscribers', subscribersRouter());
  api.use('/staff', staffRouter(cfg));
  api.use('/users', usersRouter());
  api.use('/ibja', ibjaRouter(cfg, { fetchFn: deps.fetchFn }));
  api.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));
  app.use('/api/v1', api);

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof ZodError) { res.status(422).json({ error: 'Invalid input', details: err.flatten() }); return; }
    if (err?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON body' }); return; }
    if (err?.code === 11000) { res.status(409).json({ error: 'Duplicate record' }); return; }
    req.log?.error({ err }, 'unhandled error');
    sentryCapture?.(err, { requestId: req.id });
    res.status(500).json({ error: 'Something went wrong. It has been logged.', requestId: req.id });
  };
  app.use(onError);
  return app;
}
