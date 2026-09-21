import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config';
import { audit } from '../lib/audit';
import { requireAuth, requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { autoDraftFromIbja, fetchAndStoreIbja, ibjaHistory, ibjaSettings, latestIbja, pickIbjaForDraft } from '../services/ibja';
import type { FetchLike } from '../services/ibja/sources';
import { IbjaFetch, getSettings } from '../models';

export function ibjaRouter(cfg: Config, deps: { fetchFn?: FetchLike } = {}) {
  const r = Router();
  r.use(requireAuth);
  r.get('/latest', async (_req, res) => {
    const s = await getSettings(); const st = ibjaSettings(s);
    // `latest` = the snapshot a draft would use (preferred session of the newest date) so the panel and auto-draft always agree
    const [latest, newest, lastFetch] = await Promise.all([pickIbjaForDraft(st.preferSession), latestIbja(), IbjaFetch.findOne().sort({ at: -1 }).lean()]);
    res.json({ latest, newest, settings: st, source: cfg.IBJA_SOURCE, lastFetch: lastFetch ? { at: lastFetch.at, ok: lastFetch.ok, error: lastFetch.error, slot: lastFetch.slot } : null });
  });
  r.get('/history', async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(120).default(30) }), req.query);
    res.json({ items: await ibjaHistory(limit) });
  });
  /** Manual refresh – admin, limited (the official API allows 40 hits/day). */
  r.post('/refresh', requireRole('admin'), rateLimit({ windowMs: 60 * 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 6, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const out = await fetchAndStoreIbja(cfg, { slot: 'manual', by: req.user!.email, fetchFn: deps.fetchFn });
    await audit(req, 'ibja_refresh', 'ibja', 'latest', undefined, { ok: out.ok, latest: out.latest && `${out.latest.rateDate} ${out.latest.session}` });
    res.status(out.ok ? 200 : 502).json(out);
  });
  /** Manual "draft from IBJA now" – admin. */
  r.post('/draft', requireRole('admin'), rateLimit({ windowMs: 60 * 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const out = await autoDraftFromIbja(cfg, { force: true });
    await audit(req, 'ibja_draft', 'rate', 'date' in out ? out.date : '-', undefined, out);
    res.status(out.action === 'blocked' ? 422 : 200).json(out);
  });
  return r;
}
