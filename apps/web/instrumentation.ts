// Next.js server/edge Sentry init – no-op without NEXT_PUBLIC_SENTRY_DSN.
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, environment: process.env.NODE_ENV, release: process.env.NEXT_PUBLIC_APP_VERSION, tracesSampleRate: 0.05, sendDefaultPii: false });
}
