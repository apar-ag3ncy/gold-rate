import { Schema, model } from 'mongoose';

/** Rendered rate images when STORAGE_DRIVER=mongo (serverless hosts such as Vercel have no disk). ~2 small JPEGs a day. */
const mediaSchema = new Schema({
  key: { type: String, required: true, unique: true },   // e.g. creative/2026-09-21/feed-2026-09-21-<hash>.jpg
  contentType: { type: String, required: true },
  data: { type: Buffer, required: true },
  size: { type: Number, required: true },
}, { timestamps: true, collection: 'media' });
export const Media = model('Media', mediaSchema);
