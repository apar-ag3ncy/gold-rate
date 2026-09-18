import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config';
import { audit } from '../lib/audit';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { pushConfigured, removeSubscription, saveSubscription } from '../services/push';
import { markPosted, staffToday } from '../services/staff';
import { deliveryToDTO } from '../services/deliveries';

const subSchema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }) });

export function staffRouter(cfg: Config) {
  const r = Router();
  r.use(requireRole('staff', 'admin'));

  /** Today's share page data – never an old rate. */
  r.get('/today', async (_req, res) => res.json(await staffToday()));

  /** Manual task → posted (once). */
  r.post('/tasks/:id/mark-posted', async (req, res) => {
    const id = parse(z.string().regex(/^[0-9a-f]{24}$/), req.params.id);
    const d = await markPosted(id, req.user!);
    await audit(req, 'manual_posted', 'delivery', id, undefined, { channel: d.channel, date: d.date });
    res.json({ task: deliveryToDTO(d) });
  });

  // ---- web push ----
  r.get('/push/vapid-public-key', (_req, res) => res.json({ publicKey: cfg.VAPID_PUBLIC_KEY ?? null, configured: pushConfigured(cfg) }));
  r.post('/push/subscribe', async (req, res) => {
    const sub = parse(subSchema, req.body);
    const out = await saveSubscription(sub, req.user!, req.get('user-agent'));
    res.status(201).json({ ok: true, ...out });
  });
  r.delete('/push/subscribe', async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().url() }), req.body);
    res.json({ ok: true, removed: await removeSubscription(endpoint, req.user!.id) });
  });
  return r;
}
