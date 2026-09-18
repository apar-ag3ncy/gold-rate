import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@chheda/shared'],
  // `NEXT_DIST_DIR=.next-build npm run build:web` keeps a production build from clobbering a running `next dev`
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // Browser talks to the same origin; Next proxies to the Express API (keeps cookies first-party).
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        // images come from the API / Cloudinary; everything else is same-origin. Next needs inline scripts/styles for hydration.
        { key: 'Content-Security-Policy', value: [
          "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'",
          "img-src 'self' data: blob: https:", "font-src 'self' https://fonts.gstatic.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
          `connect-src 'self' ${api} https://*.ingest.sentry.io https://*.ingest.de.sentry.io`, "worker-src 'self'", "manifest-src 'self'",
        ].join('; ') },
      ],
    }];
  },
};
export default config;
