import { StatusBadge } from './StatusBadge';
import { fmtTime } from '@/lib/api';

export type Delivery = {
  id: string; date: string; channel: string; trigger: string; status: string;
  recipient?: string; dryRun: boolean; requestedBy?: string; error?: string; postedBy?: string; postedAt?: string; reminderSentAt?: string; stats?: { total: number; sent: number; failed: number; skipped: number };
  creativeUrls?: { feed?: string; story?: string }; createdAt: string;
};

export const channelLabels: Record<string, string> = {
  ig_feed: 'Instagram Feed', ig_story: 'Instagram Story', wa_customers: 'WhatsApp customers',
  wa_admin: 'Test send → admin only', ig_broadcast_manual: 'Instagram Broadcast (staff)', wa_channel_manual: 'WhatsApp Channel (staff)', wa_community_manual: 'WhatsApp Community (staff)', wa_keyword: 'WhatsApp keyword reply', ig_keyword: 'Instagram keyword reply',
};
const channelIcon: Record<string, string> = { ig_feed: '▣', ig_story: '▯', wa_customers: '✆', wa_admin: '⚑', ig_broadcast_manual: '◎', wa_channel_manual: '◎', wa_community_manual: '◎' };
const triggerLabels: Record<string, string> = { cron: 'Scheduled', send_now: 'Send Now', test: 'Test', keyword: 'RATE reply' };

export function DeliveryList({ items }: { items: Delivery[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-copper/40 bg-cream/[0.05] px-4 py-6 text-center">
        <p className="text-sm font-medium text-cream-200/70">No deliveries yet for this day.</p>
        <p className="hint mt-0.5">Test sends appear here right away; real posts arrive with the scheduler.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl surface px-3 py-2.5 text-sm">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-copper/20 text-peach">{channelIcon[d.channel] ?? '•'}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{channelLabels[d.channel] ?? d.channel} <span className="text-sand/80">· {triggerLabels[d.trigger] ?? d.trigger}</span></p>
            <p className="hint truncate">
              {fmtTime(d.createdAt)}
              {d.recipient && ` · to ${d.recipient}`}{d.dryRun && ' · DRY RUN (logged only)'}
              {d.stats && ` · ${d.stats.sent}/${d.stats.total} sent, ${d.stats.failed} failed`}
              {d.postedBy && ` · posted by ${d.postedBy} at ${fmtTime(d.postedAt)}`}
              {d.status === 'pending_manual' && !d.postedBy && ' · waiting for staff'}{d.reminderSentAt && d.status === 'pending_manual' && ' · reminder sent'}
            </p>
            {d.error && <p className="text-xs text-red-300">{d.error}</p>}
          </div>
          <div className="flex items-center gap-2">
            {d.creativeUrls?.feed && <a className="btn-secondary btn-sm" href={d.creativeUrls.feed} target="_blank" rel="noreferrer">View image</a>}
            <StatusBadge status={d.status} short />
          </div>
        </li>
      ))}
    </ul>
  );
}
