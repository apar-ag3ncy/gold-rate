'use client';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { Alert } from '@/components/Alert';

type Notif = { channel: string; to?: string; status: string; error?: string; at: string };
type AlertItem = { id: string; type: string; severity: string; message: string; date?: string; status: 'open' | 'acked'; ackBy?: string; ackAt?: string; createdAt: string; notifiedAt?: string; notifications: Notif[] };
const TYPES = ['rate_missing', 'send_failed', 'partial_send', 'token_expiring', 'manual_pending', 'health_check', 'day_skipped'];
const sev: Record<string, string> = { critical: 'bg-red-400/15 text-red-100 ring-red-300/30', warning: 'bg-amber-400/15 text-amber-100 ring-amber-300/30', info: 'bg-cream/10 text-cream-200 ring-cream-200/20' };
const when = (d?: string) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '';

export default function AlertsPage() {
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [status, setStatus] = useState<'open' | 'acked' | ''>('open');
  const [type, setType] = useState('');
  const [date, setDate] = useState('');
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; title: string } | null>(null);
  const load = () => {
    const q = new URLSearchParams({ limit: '200', ...(status && { status }), ...(type && { type }), ...(date && { date }) });
    return api<{ items: AlertItem[]; openCount: number }>(`/alerts?${q}`).then((r) => { setItems(r.items); setOpenCount(r.openCount); }).catch((e) => setMsg({ kind: 'error', title: e.message }));
  };
  useEffect(() => { load(); }, [status, type, date]);
  useEffect(() => { api<{ user: { role: string } }>('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);
  async function ack(id: string) { try { await api(`/alerts/${id}/ack`, { method: 'POST' }); await load(); } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); } }
  async function ackAll() {
    if (!items || !window.confirm(`Acknowledge all ${items.filter((i) => i.status === 'open').length} open alerts shown?`)) return;
    for (const i of items.filter((x) => x.status === 'open')) await api(`/alerts/${i.id}/ack`, { method: 'POST' }).catch(() => {});
    await load();
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="page-title">Alerts</h1><p className="text-sm text-cream-200/70">{openCount} open · sent to admins by email / WhatsApp (max once per type per 30 min)</p></div>
        <div className="glass flex flex-wrap items-end gap-2 p-2">
          <div><label className="label mb-1 text-xs" htmlFor="st">Status</label><select id="st" className="input py-1.5" value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="">All</option><option value="open">Open</option><option value="acked">Acknowledged</option></select></div>
          <div><label className="label mb-1 text-xs" htmlFor="ty">Type</label><select id="ty" className="input py-1.5" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
          <div><label className="label mb-1 text-xs" htmlFor="dt">Date</label><input id="dt" type="date" className="input py-1.5" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {me && me.role !== 'viewer' && status === 'open' && items && items.length > 0 && <button className="btn-secondary btn-sm" onClick={ackAll}>Ack all</button>}
        </div>
      </div>
      {msg && <Alert {...msg} />}
      <section className="card p-0 sm:p-0">
        {!items ? <p className="p-4 text-sand">Loading…</p> : items.length === 0 ? <p className="p-6 text-center text-sand">No alerts match.</p> : (
          <ul className="divide-y divide-cream-200/10">
            {items.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ring-1 ring-inset ${sev[a.severity] ?? sev.info}`}>{a.severity}</span>
                    {a.type.replace(/_/g, ' ')}{a.date && <span className="font-normal text-sand">· {fmtDate(a.date)}</span>}
                  </p>
                  <p className="mt-1 text-sm text-cream-200/90">{a.message}</p>
                  <p className="hint mt-1">{when(a.createdAt)} IST{a.status === 'acked' && ` · acknowledged by ${a.ackBy} ${when(a.ackAt)}`}
                    {a.notifications.length > 0 && <> · notified: {a.notifications.map((n) => `${n.channel} ${n.status}${n.to ? ` (${n.to})` : ''}`).join(', ')}</>}</p>
                </div>
                {a.status === 'open' && me && me.role !== 'viewer' && <button className="btn-secondary btn-sm self-start" onClick={() => ack(a.id)}>Acknowledge</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
