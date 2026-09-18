import type { NextConfig } from 'next';
// @ts-expect-error plain ESM helper (unit-tested in packages/shared/test/csp.test.ts)
import { buildCsp } from './lib/csp.mjs';

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
        { key: 'Content-Security-Policy', value: buildCsp({ apiUrl: api, mediaUrl: process.env.MEDIA_PUBLIC_URL ?? api, isProd: process.env.NODE_ENV === 'production' }) },
      ],
    }];
  },
};
export default config;
