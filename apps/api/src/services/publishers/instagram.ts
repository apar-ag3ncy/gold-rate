import { logger } from '../../lib/logger';
import { MetaApiError, MetaClient, PublishError } from '../meta/client';
import type { PublishPayload, PublishResult, Publisher } from './index';

export interface InstagramCreds { igUserId: string; accessToken: string }
export interface InstagramOptions { timeoutMs?: number; sleep?: (ms: number) => Promise<void>; pollBaseMs?: number }

/**
 * Official Instagram Graph API content publishing:
 *   quota check → POST /{ig-user-id}/media (container) → poll status_code until FINISHED → POST /{ig-user-id}/media_publish
 * Feed uses image_url + caption; Story adds media_type=STORIES (no caption).
 */
export class InstagramPublisher implements Publisher {
  constructor(
    readonly channel: 'ig_feed' | 'ig_story',
    private readonly client: MetaClient,
    private readonly creds: InstagramCreds,
    private readonly o: InstagramOptions = {},
  ) {}

  async publish(p: PublishPayload): Promise<PublishResult> {
    const { igUserId, accessToken } = this.creds;
    const story = this.channel === 'ig_story';

    // 1. content publishing limit (100 posts / 24 h) – permanent failure if reached
    const limit = await this.client.get<{ data?: { quota_usage: number; config: { quota_total: number } }[] }>(`${igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' }, accessToken);
    const q = limit.data?.[0];
    if (q && q.quota_usage >= q.config.quota_total) {
      throw new PublishError(`Instagram publishing limit reached (${q.quota_usage}/${q.config.quota_total} in 24 h). Try again later.`, false);
    }

    // 2. container
    const body: Record<string, unknown> = story ? { image_url: p.storyUrl, media_type: 'STORIES' } : { image_url: p.feedUrl, caption: p.caption };
    const container = await this.client.post<{ id: string }>(`${igUserId}/media`, body, accessToken);
    if (!container?.id) throw new PublishError('Instagram did not return a container id', true);

    // 3. poll until FINISHED (backoff 2 s, 4 s, 8 s … capped) or time out
    const sleep = this.o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const timeoutMs = this.o.timeoutMs ?? 120_000;
    const base = this.o.pollBaseMs ?? 2000;
    let waited = 0, attempt = 0;
    while (true) {
      const st = await this.client.get<{ status_code?: string; status?: string }>(container.id, { fields: 'status_code,status' }, accessToken);
      const code = st.status_code;
      if (code === 'FINISHED') break;
      if (code === 'ERROR' || code === 'EXPIRED') throw new PublishError(`Instagram container ${code}: ${st.status ?? 'no details'}`, code === 'EXPIRED');
      if (waited >= timeoutMs) throw new PublishError(`Instagram container ${container.id} still ${code ?? 'processing'} after ${Math.round(timeoutMs / 1000)} s`, true);
      const delay = Math.min(base * 2 ** attempt, 15_000);
      await sleep(delay); waited += delay; attempt++;
    }

    // 4. publish
    const published = await this.client.post<{ id: string }>(`${igUserId}/media_publish`, { creation_id: container.id }, accessToken);
    if (!published?.id) throw new PublishError('Instagram did not return a media id', true);
    logger.info({ channel: this.channel, mediaId: published.id, date: p.date }, 'Instagram published');
    return { externalId: published.id, detail: story ? 'story' : 'feed' };
  }
}

export const isPermanentMetaError = (e: unknown) => (e instanceof MetaApiError || e instanceof PublishError) && !e.retryable;
