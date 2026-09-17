import mongoose from 'mongoose';
import { connectDb } from './db';
import { User, getSettings } from './models';
import { hashPassword, validatePasswordStrength } from './lib/auth';

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) { console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env'); process.exit(1); }
// Strong passwords are mandatory in production. Locally you may opt out with SEED_ALLOW_WEAK_PASSWORD=true.
const weak = validatePasswordStrength(password);
const allowWeak = process.env.SEED_ALLOW_WEAK_PASSWORD === 'true' && process.env.NODE_ENV !== 'production';
if (weak && !allowWeak) { console.error(`${weak} (set SEED_ALLOW_WEAK_PASSWORD=true to override outside production)`); process.exit(1); }
if (weak && allowWeak) console.warn(`WARNING: weak password accepted for local development – ${weak}`);

await connectDb(process.env.MONGO_URI!);
await getSettings();
const existing = await User.findOne({ email: email.toLowerCase() });
if (existing && process.env.SEED_RESET_PASSWORD === 'true') {
  existing.passwordHash = await hashPassword(password); existing.failedLogins = 0; existing.lockedUntil = undefined;
  await existing.save();
  console.log(`Password for ${email} reset.`);
} else if (existing) console.log(`Admin ${email} already exists – nothing changed (SEED_RESET_PASSWORD=true to reset the password).`);
else {
  await User.create({ email, name: 'Admin', role: 'admin', passwordHash: await hashPassword(password) });
  console.log(`Admin ${email} created. Remove SEED_ADMIN_PASSWORD from .env now.`);
}
await mongoose.disconnect();
