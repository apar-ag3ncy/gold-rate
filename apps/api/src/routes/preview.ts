import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { dateParamSchema, rateInputSchema } from '@chheda/shared';
import type { Config } from '../config';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { previewSavedRate, previewUnsavedValues } from '../services/preview';
import type { StorageAdapter } from '../services/storage';

const unsavedSchema = rateInputSchema.extend({ date: dateParamSchema });

export function previewRouter(cfg: Config, storage: StorageAdapter) {
  const r = Router();
  // Rendering is CPU-bound (~0.5 s per pair); keep it admin-only and rate-limited.
  r.use(requireRole('admin'), rateLimit({ windowMs: 60_000, limit: cfg.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false }));

  /** Render from UNSAVED form values (same validation as saving). Nothing is saved. */
  r.post('/', async (req, res) => {
    const { date, ...input } = parse(unsavedSchema, req.body);
    const out = await previewUnsavedValues(storage, date, input);
    res.json({ ...out, saved: false });
  });

  /** Render the SAVED rate for a date (draft / approved / sent). */
  r.post('/:date', async (req, res) => {
    const date = parse(dateParamSchema, req.params.date);
    const out = await previewSavedRate(storage, date);
    res.json({ ...out, saved: true });
  });

  return r;
}

