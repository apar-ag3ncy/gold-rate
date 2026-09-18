import pino from 'pino';
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-hub-signature-256"]', '*.password', '*.passwordHash', '*.token', '*.accessToken', '*.encryptedToken', '*.phoneEnc', '*.privateKey', '*.apiSecret', '*.firstPassword', '*.newPassword', 'res.headers["set-cookie"]'], censor: '[redacted]' },
});
