import { Schema, model } from 'mongoose';

/** SPEC §6 job_locks: one worker at a time per job name. */
const jobLockSchema = new Schema({
  name: { type: String, required: true, unique: true },
  lockedUntil: { type: Date, required: true },
  owner: { type: String, required: true },
}, { timestamps: true, collection: 'job_locks' });

export const JobLock = model('JobLock', jobLockSchema);
