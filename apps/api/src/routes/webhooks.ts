import { Router } from 'express';
import type { Config } from '../config';
import { logger } from '../lib/logger';
import { processInstagramEvent, processWhatsAppEvent, verifySignature } from '../services/webhooks';

declare global { namespace Express { interface Request { rawBody?: Buffer } } }

/**
 * Meta webhooks. Mounted OUTSIDE the session/CSRF-guarded API router: Meta has no cookie and no custom header.
 * Security = verify token on GET, HMAC signature (X-Hub-Signature-256) on POST. 200 is returned immediately;
 * processing happens afterwards and is idempotent on event id.
 */
export function webhooksRouter(cfg: Config) {
  const r = Router();

  const verify = (req: any, res: any) => {
    const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && cfg.META_WEBHOOK_VERIFY_TOKEN && token === cfg.META_WEBHOOK_VERIFY_TOKEN && typeof challenge === 'string') {
      res.status(200).type('text/plain').send(challenge);
    } else res.status(403).json({ error: 'Verification failed' });
  };
  r.get('/whatsapp', verify);
  r.get('/instagram', verify);

  const receive = (source: 'whatsapp' | 'instagram') => (req: any, res: any) => {
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), cfg.META_APP_SECRET)) {
      logger.warn({ source }, 'webhook rejected: bad signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    res.status(200).json({ ok: true });
    const body = req.body;
    setImmediate(() => {
      (source === 'whatsapp' ? processWhatsAppEvent(body, cfg) : processInstagramEvent(body))
        .then((summary) => logger.info({ source, ...summary }, 'webhook processed'))
        .catch((err) => logger.error({ err, source }, 'webhook processing failed'));
    });
  };
  r.post('/whatsapp', receive('whatsapp'));
  r.post('/instagram', receive('instagram'));
  return r;
}
