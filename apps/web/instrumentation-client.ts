// Browser Sentry init – no-op without NEXT_PUBLIC_SENTRY_DSN. Scrubs phone numbers from messages.
import * as Sentry from '@sentry/nextjs';
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, environment: process.env.NODE_ENV, release: process.env.NEXT_PUBLIC_APP_VERSION,
    tracesSampleRate: 0.05, sendDefaultPii: false, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0,
    beforeSend(event) { const scrub = (s: string) => s.replace(/\+?\d{10,15}/g, '[phone]'); if (event.message) event.message = scrub(event.message); for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value); return event; },
  });
}
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
