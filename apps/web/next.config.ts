import type { NextConfig } from 'next';
// @ts-expect-error plain ESM helper (unit-tested in packages/shared/test/csp.test.ts)
import { buildCsp } from './lib/csp.mjs';

// External API (local dev: http://localhost:4000 from .env.local; a separate server). When unset – e.g. on Vercel – the API runs
// inside this project: pages/api/[...path].ts hands every /api/* request to the Express app, and /media/* is served from MongoDB.
const api = process.env.API_INTERNAL_URL || '';

const config: NextConfig = {
  transpilePackages: ['@chheda/shared', '@chheda/api'],
  // `NEXT_DIST_DIR=.next-build npm run build:web` keeps a production build from clobbering a running `next dev`
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // Next 16 "next dev" otherwise writes AGENTS.md + CLAUDE.md into apps/web on every start; project instructions live in the root CLAUDE.md.
  agentRules: false,
  // Browser talks to the same origin; Next proxies to the Express API (keeps cookies first-party).
  async rewrites() {
    return {
      beforeFiles: api ? [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }] : [{ source: '/media/:path*', destination: '/api/media/:path*' }],
      afterFiles: [], fallback: [],
    };
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
        { key: 'Content-Security-Policy', value: buildCsp({ apiUrl: api || 'http://localhost:3000', mediaUrl: process.env.MEDIA_PUBLIC_URL ?? (api || 'http://localhost:3000'), isProd: process.env.NODE_ENV === 'production' }) },
      ],
    }];
  },
};
export default config;
