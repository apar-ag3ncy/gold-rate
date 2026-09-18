/**
 * Content-Security-Policy for the dashboard. Pure so it can be unit-tested.
 * Production: images only from https (Cloudinary / the https API). Development: the API's http origin is added,
 * because rate images are served from http://localhost:4000/media/…  (BUG 2).
 */
export function buildCsp({ apiUrl, mediaUrl, isProd }) {
  const origin = (u) => { try { return new URL(u).origin; } catch { return null; } };
  const apiOrigin = origin(apiUrl), mediaOrigin = origin(mediaUrl ?? apiUrl);
  const allowed = (o) => !!o && (!isProd || o.startsWith('https://'));   // production: https origins only
  const extraImg = [...new Set([apiOrigin, mediaOrigin])].filter(allowed);
  const connectApi = allowed(apiOrigin) ? apiOrigin : '';
  return [
    "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'",
    `img-src 'self' data: blob: https:${extraImg.length ? ' ' + extraImg.join(' ') : ''}`,
    "font-src 'self' https://fonts.gstatic.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    `connect-src 'self' ${connectApi} https://*.ingest.sentry.io https://*.ingest.de.sentry.io`.replace(/\s+/g, ' '),
    "worker-src 'self'", "manifest-src 'self'",
  ].join('; ');
}
