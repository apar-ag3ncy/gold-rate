const styles: Record<string, string> = {
  draft: 'bg-amber-400/15 text-amber-100 ring-amber-300/30',
  approved: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30',
  sent: 'bg-sky-400/15 text-sky-100 ring-sky-300/30',
  cancelled: 'bg-cream/10 text-cream-200 ring-cream-200/20',
  missing: 'bg-red-400/15 text-red-100 ring-red-300/30',
  test: 'bg-peach/15 text-peach ring-peach/30',
  queued: 'bg-amber-400/15 text-amber-100 ring-amber-300/30',
  success: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30',
  failed: 'bg-red-400/15 text-red-100 ring-red-300/30',
  pending_manual: 'bg-amber-400/15 text-amber-100 ring-amber-300/30',
  skipped: 'bg-cream/10 text-cream-200 ring-cream-200/20',
  not_connected: 'bg-cream/10 text-cream-200 ring-cream-200/20',
  connected: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30',
};
const dots: Record<string, string> = { connected: 'bg-emerald-300', draft: 'bg-amber-300', approved: 'bg-emerald-300', sent: 'bg-sky-300', cancelled: 'bg-cream-300', missing: 'bg-red-300', test: 'bg-peach', success: 'bg-emerald-300', failed: 'bg-red-300' };
const labels: Record<string, string> = { draft: 'Draft – needs approval', approved: 'Approved', sent: 'Sent', cancelled: 'Cancelled', missing: 'Not entered', test: 'Test', pending_manual: 'Pending (staff)', not_connected: 'Not connected', connected: 'Connected', success: 'Sent', failed: 'Failed', skipped: 'Skipped', queued: 'Queued' };

export function StatusBadge({ status, short }: { status: string; short?: boolean }) {
  const text = short ? (labels[status] && status !== 'draft' ? labels[status] : status.charAt(0).toUpperCase() + status.slice(1)) : labels[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset ${styles[status] ?? 'bg-cream/10 ring-cream-200/20'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[status] ?? 'bg-cream-300'}`} />{text}
    </span>
  );
}
