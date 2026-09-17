import { buildCaption, type RateInput } from '@chheda/shared';
import { getSettings, Rate } from '../models';
import { conflict, notFound } from '../lib/errors';
import { renderCreatives, type CreativeData } from './creative';
import { creativeKey, type StorageAdapter } from './storage';
import { checkRate } from './rates';
import { unprocessable } from '../lib/errors';

export interface RenderedRate {
  date: string;
  feedUrl: string;
  storyUrl: string;
  caption: string;
  keys: { feed: string; story: string };
}

/** Render both images + caption for the given values and store them. Values are used exactly as given. */
export async function renderAndStore(storage: StorageAdapter, data: CreativeData, prefix: 'creative' | 'preview'): Promise<RenderedRate> {
  const settings = await getSettings();
  const { feed, story } = await renderCreatives(data);
  const [f, s] = await Promise.all([
    storage.save(feed, creativeKey(prefix, data.date, 'feed', feed), 'image/jpeg'),
    storage.save(story, creativeKey(prefix, data.date, 'story', story), 'image/jpeg'),
  ]);
  const caption = buildCaption(settings.captionTemplate, data);
  return { date: data.date, feedUrl: f.url, storyUrl: s.url, caption, keys: { feed: f.key, story: s.key } };
}

/** Preview for a SAVED rate (draft / approved / sent). Remembers the URLs on the rate unless it was already sent. */
export async function previewSavedRate(storage: StorageAdapter, date: string): Promise<RenderedRate & { status: string }> {
  const rate = await Rate.findOne({ date });
  if (!rate) throw notFound(`No rate saved for ${date}`);
  if (rate.status === 'cancelled') throw conflict('This rate was cancelled. Save it again to preview.');
  const data: CreativeData = { date, k24: rate.k24, k22: rate.k22, k18: rate.k18, extraPurities: rate.extraPurities.map((p) => ({ label: p.label!, value: p.value! })) };
  const out = await renderAndStore(storage, data, 'creative');
  if (rate.status !== 'sent') {
    rate.set({ creativeUrls: { feed: out.feedUrl, story: out.storyUrl }, caption: out.caption });
    await rate.save();
  }
  return { ...out, status: rate.status };
}

/** Preview for UNSAVED form values: same validation as saving; nothing is written to the database. */
export async function previewUnsavedValues(storage: StorageAdapter, date: string, input: RateInput): Promise<RenderedRate & { warnings: string[] }> {
  const result = await checkRate(date, input);
  if (!result.ok) throw unprocessable('Preview not generated – please fix the problems below', { errors: result.errors, warnings: result.warnings });
  const data: CreativeData = { date, k24: input.k24, k22: input.k22, k18: input.k18, extraPurities: input.extraPurities };
  const out = await renderAndStore(storage, data, 'preview');
  return { ...out, warnings: result.warnings };
}
