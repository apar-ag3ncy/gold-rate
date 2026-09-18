'use client';
import { Fragment, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { addDays, defaultDeliveryLogRange, istDate } from '@chheda/shared';
import { api, channelLabel, fmtDate, fmtDateTime, triggerLabel } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { CardSkeleton, EmptyState, ErrorState, LoadingGuard, PageHeader, Pager } from '@/components/ui';
import type { Delivery } from '@/components/DeliveryList';

type Row = Delivery & { attempts: number; externalId?: string; metaErrorCode?: number; retryable?: boolean; caption?: string; waStatus?: string };
type KeywordLog = { date: string; todayCount: number; items: { id: string; channel: string; status: string; recipientMasked?: string; kind: string; error?: string; dryRun: boolean; createdAt: string }[] };
const CHANNELS = Object.keys(channelLabel);
const STATUSES = ['queued', 'success', 'failed', 'pending_manual', 'skipped', 'test'];

function DeliveriesLog() {
  const today = istDate();
  const params = useSearchParams();
  const defaults = defaultDeliveryLogRange(today, addDays);   // BUG 4: include the coming week (tomorrow's test sends)
  const initial = { from: params.get('from') ?? defaults.from, to: params.get('to') ?? defaults.to, channel: params.get('channel') ?? '', status: params.get('status') ?? '', trigger: params.get('trigger') ?? '', page: 1 };
  const highlight = params.get('highlight');
  const [f, setF] = useState(initial);
  const [data, setData] = useState<{ total: number; items: Row[] } | null>(null);
  const [kw, setKw] = useState<KeywordLog | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(highlight);
  const qs = () => new URLSearchParams({ from: f.from, to: f.to, page: String(f.page), limit: '25', ...(f.channel && { channel: f.channel }), ...(f.status && { status: f.status }), ...(f.trigger && { trigger: f.trigger }) }).toString();
  const load = () => api<{ total: number; items: Row[] }>(`/deliveries/log?${qs()}`).then((r) => { setData(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [f]);
  useEffect(() => { api<KeywordLog>('/deliveries/keyword').then(setKw).catch(() => {}); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value, page: 1 });

  return (
    <div className="space-y-5">
      <PageHeader title="Delivery log" sub="Every automatic send, staff task and test, with Meta's response.">
        <a className="btn-secondary" href={`/api/v1/deliveries/export.csv?${qs()}`}>Export CSV</a>
      </PageHeader>
      <form className="glass flex flex-wrap items-end gap-2 p-3" onSubmit={(e) => e.preventDefault()}>
        <div><label className="label mb-1 text-xs" htmlFor="from">From</label><input id="from" type="date" className="input py-1.5" value={f.from} onChange={set('from')} /></div>
        <div><label className="label mb-1 text-xs" htmlFor="to">To</label><input id="to" type="date" className="input py-1.5" value={f.to} onChange={set('to')} /></div>
        <div><label className="label mb-1 text-xs" htmlFor="ch">Channel</label><select id="ch" className="input py-1.5" value={f.channel} onChange={set('channel')}><option value="">All</option>{CHANNELS.map((c) => <option key={c} value={c}>{channelLabel[c]}</option>)}</select></div>
        <div><label className="label mb-1 text-xs" htmlFor="st">Status</label><select id="st" className="input py-1.5" value={f.status} onChange={set('status')}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
        <div><label className="label mb-1 text-xs" htmlFor="tr">Trigger</label><select id="tr" className="input py-1.5" value={f.trigger} onChange={set('trigger')}><option value="">All</option>{Object.entries(triggerLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setF({ ...defaults, channel: '', status: '', trigger: '', page: 1 })}>Reset</button>
      </form>
      {err && <ErrorState message={err} retry={load} />}
      {!data ? <CardSkeleton lines={6} /> : data.items.length === 0 ? <EmptyState title="No deliveries match these filters" /> : (
        <section className="card p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-cream-200/15 bg-cream/[0.04] text-[11px] uppercase tracking-wider text-sand"><tr><th className="px-4 py-3">When</th><th className="pr-3">Date</th><th className="pr-3">Channel</th><th className="pr-3">Trigger</th><th className="pr-3">Status</th><th className="pr-3">Attempts</th><th /></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <Fragment key={r.id}>
                    <tr id={`row-${r.id}`} className={`border-b border-cream-200/10 hover:bg-cream/[0.04] ${highlight === r.id ? 'bg-copper/15' : ''}`}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{fmtDateTime(r.createdAt)}</td>
                      <td className="whitespace-nowrap pr-3 text-xs">{fmtDate(r.date)}</td>
                      <td className="pr-3">{channelLabel[r.channel] ?? r.channel}{r.recipient && <span className="block text-xs text-cream-200/70">to {r.recipient}</span>}{r.stats && <span className="block text-xs text-cream-200/70">{r.stats.sent}/{r.stats.total} sent · {r.stats.failed} failed</span>}</td>
                      <td className="pr-3 text-xs">{triggerLabel[r.trigger] ?? r.trigger}{r.dryRun && <span className="block text-sand">dry run</span>}</td>
                      <td className="pr-3"><StatusBadge status={r.status} short /></td>
                      <td className="pr-3 kbd-money">{r.attempts ?? 0}</td>
                      <td className="pr-4 text-right"><button className="btn-secondary btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</button></td>
                    </tr>
                    {open === r.id && (
                      <tr key={`${r.id}-d`} className="border-b border-cream-200/10 bg-emerald-950/40"><td colSpan={7} className="px-4 py-3 text-xs">
                        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
                          <dt className="text-sand">Meta / external id</dt><dd className="font-mono break-all">{r.externalId ?? '–'}</dd>
                          <dt className="text-sand">Error</dt><dd className={r.error ? 'text-red-200' : ''}>{r.error ?? '–'}{r.metaErrorCode && <span className="ml-2 font-mono text-sand">code {r.metaErrorCode}</span>}{r.retryable === false && r.status === 'failed' && <span className="ml-2 text-sand">(permanent)</span>}</dd>
                          <dt className="text-sand">Attempts</dt><dd>{r.attempts ?? 0}</dd>
                          {r.postedBy && <><dt className="text-sand">Marked posted</dt><dd>{r.postedBy} · {fmtDateTime(r.postedAt)}</dd></>}
                          {r.waStatus && <><dt className="text-sand">WhatsApp status</dt><dd>{r.waStatus}</dd></>}
                          {r.creativeUrls?.feed && <><dt className="text-sand">Image</dt><dd><a className="text-copper underline" href={r.creativeUrls.feed} target="_blank" rel="noreferrer">feed</a>{r.creativeUrls.story && <> · <a className="text-copper underline" href={r.creativeUrls.story} target="_blank" rel="noreferrer">story</a></>}</dd></>}
                          {r.caption && <><dt className="text-sand">Caption</dt><dd><pre className="whitespace-pre-wrap font-sans">{r.caption}</pre></dd></>}
                        </dl>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3"><Pager page={f.page} limit={25} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>
        </section>
      )}

      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-2"><div><h2 className="card-title">Keyword replies</h2><p className="hint">Customers who messaged a trigger word got today&apos;s approved rate back automatically.</p></div><span className="chip"><b className="text-cream">{kw?.todayCount ?? 0}</b> today</span></div>
        {!kw ? <CardSkeleton /> : kw.items.length === 0 ? <EmptyState title="No keyword replies yet" /> : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-sand"><tr><th className="py-1 pr-3">When</th><th className="pr-3">Channel</th><th className="pr-3">Sender</th><th className="pr-3">Reply</th><th>Status</th></tr></thead>
              <tbody>{kw.items.map((i) => (
                <tr key={i.id} className="border-t border-cream-200/10"><td className="whitespace-nowrap py-1.5 pr-3 text-xs">{fmtDateTime(i.createdAt)}</td><td className="pr-3 text-xs">{i.channel === 'wa_keyword' ? 'WhatsApp' : 'Instagram'}</td><td className="pr-3 font-mono text-xs">{i.recipientMasked}</td><td className="pr-3 text-xs">{i.kind === 'rate' ? "today's rate" : 'check back'}{i.dryRun && ' · dry run'}</td><td><StatusBadge status={i.status} short />{i.error && <span className="ml-1 text-xs text-red-200">{i.error}</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function DeliveriesPage() {
  return <Suspense fallback={<LoadingGuard />}><DeliveriesLog /></Suspense>;
}
