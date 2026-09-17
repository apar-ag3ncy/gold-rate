import mongoose from 'mongoose';
import { logger } from './lib/logger';

export async function connectDb(uri: string) {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  for (const m of Object.values(mongoose.models)) {
    await m.syncIndexes().catch((e: Error) => {
      // Some Mongo-compatible dev databases lack TTL indexes; sessions still expire via expiresAt checks.
      if (/expireAfterSeconds/.test(e.message)) logger.warn(`TTL index unsupported for ${m.modelName}; continuing`);
      else throw e;
    });
  }
  logger.info('MongoDB connected');
}
