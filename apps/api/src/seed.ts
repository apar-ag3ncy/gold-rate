import mongoose from 'mongoose';
import { connectDb } from './db';
import { User, getSettings } from './models';
import { hashPassword, validatePasswordStrength } from './lib/auth';

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) { console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env'); process.exit(1); }
const weak = validatePasswordStrength(password);
if (weak) { console.error(weak); process.exit(1); }

await connectDb(process.env.MONGO_URI!);
await getSettings();
const existing = await User.findOne({ email: email.toLowerCase() });
if (existing) console.log(`Admin ${email} already exists – nothing changed.`);
else {
  await User.create({ email, name: 'Admin', role: 'admin', passwordHash: await hashPassword(password) });
  console.log(`Admin ${email} created. Remove SEED_ADMIN_PASSWORD from .env now.`);
}
await mongoose.disconnect();
