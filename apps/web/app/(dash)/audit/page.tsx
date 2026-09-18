'use client';
import { useEffect, useState } from 'react';
import { addDays, istDate } from '@chheda/shared';
import { api, fmtDateTime } from '@/lib/api';
import { AdminOnly, CardSkeleton, EmptyState, ErrorState, PageHeader, Pager } from '@/components/ui';

type Entry = { id: string; at: string; userEmail?: string; action: string; entity?: string; entityId?: string; ip?: string; before?: any; after?: any };
const flat = (v: any, prefix = ''): Record<string, string> => {
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object') return { [prefix || 'value']: String(v) };
  return Object.entries(v).reduce((acc, [k, val]) => ({ ...acc, ...(val && typeof val === 'object' && !Array.isArray(val) ? flat(val, prefix ? `${prefix}.${k}` : k) : { [prefix ? `${prefix}.${k}` : k]: Array.isArray(val) ? JSON.stringify(val) : String(val) }) }), {} as Record<string, string>);
};
function Diff({ before, after }: { before?: any; after?: any }) {
  const b = flat(before), a = flat(after);
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  if (!keys.length) return <p className="text-xs text-sand">No details recorded.</p>;
  return (
    <table className="w-full text-xs"><thead className="text-[10px] uppercase tracking-wider text-sand"><tr><th className="py-1 pr-3 text-left">Field</th><th className="pr-3 text-left">Before</th><th className="text-left">After</th></tr></thead>
      <tbody>{keys.map((k) => { const changed = b[k] !== a[k]; return <tr key={k} className={`border-t border-cream-200/10 ${changed ? '' : 'opacity-60'}`}><td className="py-1 pr-3 font-mono">{k}</td><td className={`pr-3 ${changed && b[k] !== undefined ? 'text-red-200 line-through' : ''}`}>{b[k] ?? '–'}</td><td className={changed ? 'text-emerald-200' : ''}>{a[k] ?? '–'}</td></tr>; })}</tbody></table>
  );
}

export default function AuditPage() {
  const today = istDate();
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [f, setF] = useState({ user: '', action: '', from: addDays(today, -30), to: today, page: 1 });
  const [data, setData] = useState<{ total: number; items: Entry[]; actions: string[] } | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api<{ user: { role: string } }>('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);
  const load = () => { if (me?.role !== 'admin') return; api<any>(`/audit?${new URLSearchParams({ from: f.from, to: f.to, page: String(f.page), limit: '50', ...(f.user && { user: f.user }), ...(f.action && { action: f.action }) })}`).then((r) => { setData(r); setErr(''); }).catch((e) => setErr(e.message)); };
  useEffect(() => { load(); }, [f, me]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value, page: 1 });
  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" sub="Who changed what, and when. Secrets are always redacted." />
      <AdminOnly role={me?.role}>
        <form className="glass flex flex-wrap items-end gap-2 p-3" onSubmit={(e) => e.preventDefault()}>
          <div><label className="label mb-1 text-xs" htmlFor="u">User</label><input id="u" className="input py-1.5" placeholder="email contains…" value={f.user} onChange={set('user')} /></div>
          <div><label className="label mb-1 text-xs" htmlFor="a">Action</label><select id="a" className="input py-1.5" value={f.action} onChange={set('action')}><option value="">All</option>{(data?.actions ?? []).map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select></div>
          <div><label className="label mb-1 text-xs" htmlFor="from">From</label><input id="from" type="date" className="input py-1.5" value={f.from} onChange={set('from')} /></div>
          <div><label className="label mb-1 text-xs" htmlFor="to">To</label><input id="to" type="date" className="input py-1.5" value={f.to} onChange={set('to')} /></div>
        </form>
        {err && <ErrorState message={err} retry={load} />}
        {!data ? <CardSkeleton lines={6} /> : data.items.length === 0 ? <EmptyState title="No audit entries match" /> : (
          <section className="card p-0 sm:p-0">
            <ul className="divide-y divide-cream-200/10">
              {data.items.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="whitespace-nowrap text-xs text-cream-200/70">{fmtDateTime(e.at)}</span>
                    <span className="font-medium">{e.action.replace(/_/g, ' ')}</span>
                    {e.entity && <span className="chip">{e.entity}{e.entityId && ` · ${e.entityId}`}</span>}
                    <span className="text-xs text-cream-200/70">{e.userEmail ?? 'system'}{e.ip && ` · ${e.ip}`}</span>
                    {(e.before || e.after) && <button className="btn-secondary btn-sm ml-auto" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Diff'}</button>}
                  </div>
                  {open === e.id && <div className="mt-2 rounded-xl bg-emerald-950/40 p-3"><Diff before={e.before} after={e.after} /></div>}
                </li>
              ))}
            </ul>
            <div className="p-3"><Pager page={f.page} limit={50} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>
          </section>
        )}
      </AdminOnly>
    </div>
  );
}
