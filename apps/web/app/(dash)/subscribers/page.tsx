'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/Alert';

type Sub = { id: string; phoneMasked: string; name?: string; status: 'active' | 'opted_out' | 'invalid'; optInSource: string; optInAt: string; optOutAt?: string; lastDeliveryStatus?: string; lastDeliveryAt?: string; lastError?: string };
type Resp = { counts: { active: number; opted_out: number; invalid: number; total: number }; items: Sub[] };
type Me = { role: string };
const SOURCES = ['in_store', 'website', 'whatsapp_join', 'import', 'manual', 'other'];
const statusStyle: Record<Sub['status'], string> = { active: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30', opted_out: 'bg-cream/10 text-cream-200 ring-cream-200/20', invalid: 'bg-red-400/15 text-red-100 ring-red-300/30' };
const fmt = (d?: string) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }) : '–';

export default function SubscribersPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [filter, setFilter] = useState('');
  const [phone, setPhone] = useState(''); const [name, setName] = useState(''); const [source, setSource] = useState('in_store');
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'warning'; title: string; items?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (st = filter) => api<Resp>(`/subscribers${st ? `?status=${st}` : ''}`).then(setData).catch((e) => setMsg({ kind: 'error', title: e.message }));
  useEffect(() => { load(filter); }, [filter]);
  useEffect(() => { api<{ user: Me }>('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);
  const isAdmin = me?.role === 'admin';

  async function add() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ created: boolean; reactivated: boolean; item: Sub }>('/subscribers', { method: 'POST', body: { phone, optInSource: source, name: name || undefined } });
      setMsg({ kind: 'success', title: r.created ? `Added ${r.item.phoneMasked}.` : r.reactivated ? `Re-subscribed ${r.item.phoneMasked}.` : `${r.item.phoneMasked} is already subscribed.` });
      setPhone(''); setName(''); await load();
    } catch (e) { setMsg({ kind: 'error', title: e instanceof ApiError ? `${e.message}${e.details?.fields ? ' – ' + Object.values(e.details.fields).join(', ') : ''}` : (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function importCsv() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ added: number; reactivated: number; alreadyActive: number; errors: { row: number; problem: string }[] }>('/subscribers/import', { method: 'POST', body: { csv } });
      setMsg({ kind: r.errors.length ? 'warning' : 'success', title: `Imported: ${r.added} added, ${r.reactivated} re-subscribed, ${r.alreadyActive} already active${r.errors.length ? `, ${r.errors.length} row(s) skipped` : ''}.`, items: r.errors.slice(0, 20).map((e) => `Row ${e.row}: ${e.problem}`) });
      if (!r.errors.length) setCsv(''); await load();
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function remove(s: Sub) {
    if (!window.confirm(`Remove ${s.phoneMasked} from the list? (To respect an opt-out, prefer leaving it as "opted out".)`)) return;
    try { await api(`/subscribers/${s.id}`, { method: 'DELETE' }); await load(); } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) f.text().then(setCsv); }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">WhatsApp subscribers</h1>
          <p className="text-sm text-cream-200/70">Opted-in customers who receive the daily rate. Numbers are stored encrypted and shown masked.</p>
        </div>
        {data && (
          <div className="flex gap-2">
            {(['active', 'opted_out', 'invalid'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(filter === k ? '' : k)} className={`chip ${filter === k ? 'ring-1 ring-copper' : ''}`}><b className="text-cream">{data.counts[k]}</b> {k.replace('_', ' ')}</button>
            ))}
          </div>
        )}
      </div>
      {msg && <Alert {...msg} />}

      {isAdmin && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card space-y-3">
            <h2 className="card-title">Add a subscriber</h2>
            <p className="hint">Only add people who have opted in (in-store form, website, or a JOIN message).</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <div><label className="label" htmlFor="ph">Phone (E.164)</label><input id="ph" className="input font-mono" placeholder="+919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div><label className="label" htmlFor="nm">Name (optional)</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><label className="label" htmlFor="src">Opt-in source</label>
                <select id="src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
              <div className="flex items-end"><button className="btn-primary w-full" onClick={add} disabled={busy || !phone}>Add</button></div>
            </div>
          </section>
          <section className="card space-y-3">
            <h2 className="card-title">Import CSV</h2>
            <p className="hint">Columns: <code className="font-mono">phone,optInSource,name</code>. Each row needs an opt-in source ({SOURCES.join(', ')}). Invalid rows are reported and skipped.</p>
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-xs text-sand file:mr-3 file:rounded-full file:border file:border-copper/50 file:bg-transparent file:px-3 file:py-1 file:text-[10px] file:uppercase file:tracking-wider file:text-cream" />
            <textarea className="input font-mono text-xs" rows={5} placeholder={'phone,optInSource,name\n+919876543210,in_store,Priya'} value={csv} onChange={(e) => setCsv(e.target.value)} />
            <button className="btn-secondary" onClick={importCsv} disabled={busy || !csv.trim()}>Import</button>
          </section>
        </div>
      )}

      <section className="card p-0 sm:p-0">
        {!data ? <p className="p-4 text-sand">Loading…</p> : data.items.length === 0 ? <p className="p-6 text-center text-sand">No subscribers{filter ? ` with status "${filter}"` : ' yet'}.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-cream-200/15 bg-cream/[0.04] text-[11px] uppercase tracking-wider text-sand">
                <tr><th className="px-4 py-3">Number</th><th className="pr-3">Name</th><th className="pr-3">Status</th><th className="pr-3">Opt-in</th><th className="pr-3">Last delivery</th><th /></tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="border-b border-cream-200/10">
                    <td className="px-4 py-2.5 font-mono">{s.phoneMasked}</td>
                    <td className="pr-3">{s.name ?? '–'}</td>
                    <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${statusStyle[s.status]}`}>{s.status.replace('_', ' ')}</span></td>
                    <td className="pr-3 text-xs text-cream-200/80">{s.optInSource.replace('_', ' ')} · {fmt(s.optInAt)}{s.optOutAt && <span className="block text-sand">opted out {fmt(s.optOutAt)}</span>}</td>
                    <td className="pr-3 text-xs text-cream-200/80">{s.lastDeliveryStatus ? `${s.lastDeliveryStatus} · ${fmt(s.lastDeliveryAt)}` : '–'}{s.lastError && <span className="block text-red-200">{s.lastError}</span>}</td>
                    <td className="pr-4 text-right">{isAdmin && <button className="btn-danger btn-sm" onClick={() => remove(s)}>Remove</button>}</td>
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
