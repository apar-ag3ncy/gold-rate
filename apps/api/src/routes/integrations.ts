import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { INTEGRATION_CHANNELS } from '@chheda/shared';
import type { Config } from '../config';
import { audit } from '../lib/audit';
import { requireAuth, requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { listIntegrations, removeIntegration, saveIntegration, testConnection } from '../services/integrations';

const channelParam = z.enum(INTEGRATION_CHANNELS);
const saveSchema = z.object({
  accessToken: z.string().trim().min(20, 'Token looks too short').max(4000).optional(),
  accountId: z.string().trim().regex(/^\d{3,30}$/, 'Numeric id').optional().or(z.literal('')),
  phoneNumberId: z.string().trim().regex(/^\d{3,30}$/, 'Numeric id').optional().or(z.literal('')),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

export function integrationsRouter(cfg: Config) {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (_req, res) => res.json({ items: await listIntegrations(), dryRun: cfg.DRY_RUN, graphVersion: cfg.META_GRAPH_VERSION, webhooksConfigured: !!(cfg.META_APP_SECRET && cfg.META_WEBHOOK_VERIFY_TOKEN) }));

  /** Write-only: the token is encrypted and never echoed back. */
  r.put('/:channel', requireRole('admin'), async (req, res) => {
    const channel = parse(channelParam, req.params.channel);
    const body = parse(saveSchema, req.body);
    const item = await saveIntegration(channel, { ...body, expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt ? new Date(body.expiresAt) : null }, req.user!.email);
    await audit(req, 'integration_update', 'integration', channel, undefined, { accountId: item.accountId, phoneNumberId: item.phoneNumberId, tokenChanged: !!body.accessToken });
    res.json({ item });
  });

  r.delete('/:channel', requireRole('admin'), async (req, res) => {
    const channel = parse(channelParam, req.params.channel);
    await removeIntegration(channel);
    await audit(req, 'integration_remove', 'integration', channel);
    res.json({ ok: true });
  });

  r.post('/:channel/test', requireRole('admin'), rateLimit({ windowMs: 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const channel = parse(channelParam, req.params.channel);
    const result = await testConnection(channel, cfg);
    await audit(req, 'integration_test', 'integration', channel, undefined, { ok: result.ok });
    res.json({ result, items: await listIntegrations() });
  });
  return r;
}
