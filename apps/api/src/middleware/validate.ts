import type { z, ZodTypeAny } from 'zod';
import { unprocessable } from '../lib/errors';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    throw unprocessable('Please fix the highlighted fields', { fields });
  }
  return r.data;
}
