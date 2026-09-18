'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { addDays, istDate } from '@chheda/shared';
import { api, fmtDate, perGram } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui';
import type { Rate } from '@/components/RateCard';

export default function HistoryPage() {
  const today = istDate();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 7));
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<Rate[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ from, to, limit: '366', ...(status && { status }) });
    api<{ items: Rate[] }>(`/rates?${q}`).then((r) => setItems(r.items)).catch((e) => setErr(e.message));
  }, [from, to, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Rate History</h1>
          <p className="text-sm text-cream-200/70">Every saved rate, exactly as entered.</p>
        </div>
        <div className="glass flex flex-wrap items-end gap-2 p-2">
          <div><label className="label mb-1 text-xs" htmlFor="from">From</label><input id="from" type="date" className="input py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label mb-1 text-xs" htmlFor="to">To</label><input id="to" type="date" className="input py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="label mb-1 text-xs" htmlFor="st">Status</label>
            <select id="st" className="input py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="sent">Sent</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>
      <section className="card p-0 sm:p-0">
        {err && <div className="p-4"><ErrorState message={err} /></div>}
        {!items ? <div className="p-4"><CardSkeleton lines={5} /></div> : items.length === 0 ? <div className="p-4"><EmptyState title="No rates in this range" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-cream-200/15 bg-cream/[0.05] text-[11px] uppercase tracking-wider text-sand">
                <tr><th className="px-4 py-3">Date</th><th className="pr-3">24K</th><th className="pr-3">22K</th><th className="pr-3">18K</th><th className="pr-3">Other</th><th className="pr-3">Status</th><th className="pr-3">Entered / approved by</th><th /></tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.date} className="border-b border-cream-200/10 transition hover:bg-cream/[0.05]">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium">{fmtDate(r.date)}</td>
                    <td className="kbd-money pr-3 font-bold text-copper">{perGram(r.k24)}</td>
                    <td className="kbd-money pr-3">{perGram(r.k22)}</td>
                    <td className="kbd-money pr-3">{perGram(r.k18)}</td>
                    <td className="pr-3 text-xs text-cream-200/70">{r.extraPurities.map((p) => `${p.label} ${perGram(p.value)}`).join(', ') || '–'}</td>
                    <td className="pr-3"><StatusBadge status={r.status} short /></td>
                    <td className="pr-3 text-xs text-cream-200/70">{r.enteredBy}{r.approvedBy && ` / ${r.approvedBy}`}</td>
                    <td className="pr-4"><Link className="btn-secondary btn-sm" href={`/rates?date=${r.date}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
