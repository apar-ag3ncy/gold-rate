import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ESM helper shared with next.config
import { buildCsp } from '../../../apps/web/lib/csp.mjs';

describe('BUG 2 – CSP allows the API media origin in development, stays https-only in production', () => {
  it('dev adds the http API origin to img-src', () => {
    const csp = buildCsp({ apiUrl: 'http://localhost:4000', isProd: false });
    expect(csp).toMatch(/img-src 'self' data: blob: https: http:\/\/localhost:4000/);
    expect(csp).toMatch(/connect-src 'self' http:\/\/localhost:4000/);
    expect(csp).toContain("'unsafe-eval'");
  });
  it('a separate media origin is allowed too', () => {
    expect(buildCsp({ apiUrl: 'http://localhost:4000', mediaUrl: 'http://192.168.1.5:4000/', isProd: false })).toContain('http://localhost:4000 http://192.168.1.5:4000');
  });
  it('production never adds an http origin', () => {
    const csp = buildCsp({ apiUrl: 'http://api.internal:4000', mediaUrl: 'https://res.cloudinary.com', isProd: true });
    expect(csp).toMatch(/img-src 'self' data: blob: https: https:\/\/res\.cloudinary\.com;/);
    expect(csp).not.toContain('http://api.internal');
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
