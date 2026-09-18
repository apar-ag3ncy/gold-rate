import type { Config } from '../config';

/** Sentry for API + worker. No-op without SENTRY_DSN. Scrubs PII (cookies, tokens, phone numbers) before sending. */
export async function initSentry(cfg: Pick<Config, 'SENTRY_DSN' | 'NODE_ENV' | 'APP_VERSION'>, service: 'api' | 'worker') {
  if (!cfg.SENTRY_DSN) return null;
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: cfg.SENTRY_DSN, environment: cfg.NODE_ENV, release: cfg.APP_VERSION ? `chheda-${service}@${cfg.APP_VERSION}` : undefined,
    tracesSampleRate: 0.05, sendDefaultPii: false, initialScope: { tags: { service } },
    beforeSend(event) {
      if (event.request) { delete event.request.cookies; if (event.request.headers) { delete event.request.headers.cookie; delete event.request.headers.authorization; delete event.request.headers['x-hub-signature-256']; } delete event.request.data; }
      const scrub = (s: string) => s.replace(/\+?\d{10,15}/g, '[phone]').replace(/EAA[A-Za-z0-9]{20,}/g, '[token]');
      if (event.message) event.message = scrub(event.message);
      for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value);
      return event;
    },
  });
  return Sentry;
}
