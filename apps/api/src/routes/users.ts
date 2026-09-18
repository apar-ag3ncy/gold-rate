import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@chheda/shared';
import { audit } from '../lib/audit';
import { hashPassword } from '../lib/auth';
import { conflict, forbidden, notFound } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { parse } from '../middleware/validate';
import { Session, User } from '../models';

const idParam = z.string().regex(/^[0-9a-f]{24}$/);
const createSchema = z.object({ email: z.string().trim().email('Enter a valid email'), name: z.string().trim().min(1).max(80), role: z.enum(ROLES) });
const patchSchema = z.object({ disabled: z.boolean().optional(), role: z.enum(ROLES).optional(), name: z.string().trim().min(1).max(80).optional() }).strict();

/** Readable one-time password: 3 words-ish blocks + digits, satisfies the strength rule (10+, upper, lower, digit). */
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz';
  const block = (n: number) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  return `${cap(block(4))}-${block(4)}-${crypto.randomInt(10, 99)}${crypto.randomInt(10, 99)}`;
}

export const userToDTO = (u: any) => ({ id: String(u._id), email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : undefined, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

export function usersRouter() {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/', async (_req, res) => {
    const users = await User.find().sort({ createdAt: 1 }).lean();
    const sessions = await Session.aggregate([{ $match: { expiresAt: { $gt: new Date() } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
    const active = new Map(sessions.map((s) => [String(s._id), s.n]));
    res.json({ items: users.map((u) => ({ ...userToDTO(u), activeSessions: active.get(String(u._id)) ?? 0 })) });
  });

  /** Create a user with a generated first password – returned ONCE in this response, never stored in plain text. */
  r.post('/', async (req, res) => {
    const b = parse(createSchema, req.body);
    if (await User.findOne({ email: b.email.toLowerCase() })) throw conflict('A user with this email already exists');
    const password = generatePassword();
    const u = await User.create({ email: b.email, name: b.name, role: b.role, passwordHash: await hashPassword(password) });
    await audit(req, 'user_create', 'user', String(u._id), undefined, { email: u.email, role: u.role });
    res.status(201).json({ item: userToDTO(u), firstPassword: password });
  });

  r.patch('/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(patchSchema, req.body);
    const u = await User.findById(id);
    if (!u) throw notFound('User not found');
    const self = id === req.user!.id;
    if (self && b.disabled === true) throw forbidden('You cannot disable your own account');
    if (self && b.role && b.role !== 'admin') throw forbidden('You cannot remove your own admin role');
    if (b.disabled === false && u.disabled) { u.failedLogins = 0; u.lockedUntil = undefined; }
    const before = userToDTO(u);
    u.set(b);
    await u.save();
    if (b.disabled === true) await Session.deleteMany({ userId: u._id });
    await audit(req, 'user_update', 'user', id, before, userToDTO(u));
    res.json({ item: userToDTO(u) });
  });

  /** New generated password, returned once; all sessions of that user are ended. */
  r.post('/:id/reset-password', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const u = await User.findById(id);
    if (!u) throw notFound('User not found');
    const password = generatePassword();
    u.set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: undefined });
    await u.save();
    await Session.deleteMany({ userId: u._id });
    await audit(req, 'user_reset_password', 'user', id);
    res.json({ item: userToDTO(u), newPassword: password });
  });

  /** Force logout: delete every session of that user. */
  r.post('/:id/logout', async (req, res) => {
    const id = parse(idParam, req.params.id);
    if (!(await User.exists({ _id: id }))) throw notFound('User not found');
    const del = await Session.deleteMany({ userId: id });
    await audit(req, 'user_force_logout', 'user', id, undefined, { sessions: del.deletedCount });
    res.json({ ok: true, sessions: del.deletedCount });
  });
  return r;
}
