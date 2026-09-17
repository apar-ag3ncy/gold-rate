import crypto from 'node:crypto';

/**
 * AES-256-GCM for secrets at rest (Meta tokens, phone numbers) + keyed SHA-256 for lookups.
 * Key: ENCRYPTION_KEY = 32 random bytes, base64 (`openssl rand -base64 32`). Never logged, never sent to the browser.
 */
let cached: { key: Buffer; hashKey: Buffer } | null = null;

export function loadKey(b64: string | undefined) {
  if (!b64) throw new Error('ENCRYPTION_KEY is not set – needed to store tokens and phone numbers. Generate one with: openssl rand -base64 32');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  cached = { key, hashKey: crypto.createHmac('sha256', key).update('lookup-hash').digest() };
  return cached;
}
const keys = () => cached ?? loadKey(process.env.ENCRYPTION_KEY);

/** "v1.<iv>.<tag>.<ciphertext>" (base64url) */
export function encrypt(plain: string): string {
  const { key } = keys();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function decrypt(blob: string): string {
  const { key } = keys();
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** Deterministic keyed hash (HMAC-SHA256) so a phone number can be found without decrypting every row. */
export const lookupHash = (value: string) => crypto.createHmac('sha256', keys().hashKey).update(value).digest('hex');

/** Last few characters of a secret for display ("…a1b2"). */
export const tail = (s: string, n = 4) => `…${s.slice(-n)}`;

export const timingSafeEqualStr = (a: string, b: string) => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};
