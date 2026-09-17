'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { StatusBadge } from '@/components/StatusBadge';

type Item = { channel: 'instagram' | 'whatsapp'; status: 'not_configured' | 'connected' | 'error'; hasToken: boolean; tokenTail?: string; accountId?: string; phoneNumberId?: string; displayName?: string; expiresAt?: string; lastHealthCheck?: string; lastError?: string; updatedAt?: string; updatedBy?: string };
type Resp = { items: Item[]; dryRun: boolean; graphVersion: string; webhooksConfigured: boolean };
const badge = { not_configured: 'not_connected', connected: 'success', error: 'failed' } as const;
const fmt = (d?: string) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '–';

function ConnectionCard({ item, onChange, dryRun }: { item: Item; onChange: () => Promise<void>; dryRun: boolean }) {
  const ig = item.channel === 'instagram';
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState(item.accountId ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(item.phoneNumberId ?? '');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'warning'; title: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  useEffect(() => { setAccountId(item.accountId ?? ''); setPhoneNumberId(item.phoneNumberId ?? ''); }, [item.accountId, item.phoneNumberId]);
  const days = item.expiresAt ? Math.floor((new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000) : null;

  async function save() {
    setBusy('save'); setMsg(null);
    try {
      const body: Record<string, string> = { accountId, ...(ig ? {} : { phoneNumberId }) };
      if (token) body.accessToken = token;
      await api(`/integrations/${item.channel}`, { method: 'PUT', body });
      setToken(''); await onChange();
      setMsg({ kind: 'success', title: token ? 'Saved. The token is stored encrypted and will not be shown again – click Test connection.' : 'Saved.' });
    } catch (e) { setMsg({ kind: 'error', title: e instanceof ApiError ? `${e.message}${e.details?.fields ? ' – ' + Object.values(e.details.fields).join(', ') : ''}` : (e as Error).message }); }
    finally { setBusy(null); }
  }
  async function test() {
    setBusy('test'); setMsg(null);
    try {
      const r = await api<{ result: { ok: boolean; displayName?: string; expiresAt?: string; error?: string } }>(`/integrations/${item.channel}/test`, { method: 'POST' });
      await onChange();
      setMsg(r.result.ok ? { kind: 'success', title: `Connected${r.result.displayName ? ` as ${r.result.displayName}` : ''}.${r.result.expiresAt ? ` Token expires ${fmt(r.result.expiresAt)}.` : ''}` } : { kind: 'error', title: r.result.error ?? 'Connection failed' });
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!window.confirm(`Remove the ${ig ? 'Instagram' : 'WhatsApp'} connection? Automatic sending on this channel will fail until a new token is saved.`)) return;
    setBusy('remove');
    try { await api(`/integrations/${item.channel}`, { method: 'DELETE' }); await onChange(); setMsg({ kind: 'warning', title: 'Connection removed.' }); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); } finally { setBusy(null); }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="card-title">{ig ? 'Instagram' : 'WhatsApp Cloud API'}</h2>
          <p className="font-serif text-2xl text-cream">{item.displayName ?? (ig ? 'Instagram Graph API' : 'WhatsApp Business')}</p>
        </div>
        <StatusBadge status={badge[item.status]} short />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <dt className="text-sand">Token</dt><dd>{item.hasToken ? <span className="font-mono">{item.tokenTail}</span> : 'not saved'}</dd>
        <dt className="text-sand">Expires</dt><dd className={days !== null && days <= 7 ? 'text-amber-200' : ''}>{item.expiresAt ? `${fmt(item.expiresAt)}${days !== null ? ` (${days} d)` : ''}` : item.hasToken ? 'never / unknown' : '–'}</dd>
        <dt className="text-sand">Last check</dt><dd>{fmt(item.lastHealthCheck)}</dd>
        <dt className="text-sand">Updated</dt><dd>{fmt(item.updatedAt)}{item.updatedBy && ` · ${item.updatedBy}`}</dd>
      </dl>
      {item.lastError && <p className="rounded-xl border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">Last error: {item.lastError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${item.channel}-token`}>Access token <span className="font-normal text-sand">(write-only · {item.hasToken ? 'leave blank to keep the current one' : 'permanent System User token'})</span></label>
          <input id={`${item.channel}-token`} type="password" autoComplete="off" className="input font-mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder={item.hasToken ? '••••••••••' : 'EAAB…'} />
        </div>
        <div>
          <label className="label" htmlFor={`${item.channel}-acct`}>{ig ? 'Instagram user id (IG Business account)' : 'WhatsApp Business Account id (WABA)'}</label>
          <input id={`${item.channel}-acct`} className="input font-mono" inputMode="numeric" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="1784…" />
        </div>
        {!ig && (
          <div>
            <label className="label" htmlFor="wa-phone">Phone number id</label>
            <input id="wa-phone" className="input font-mono" inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="1067…" />
          </div>
        )}
      </div>
      {msg && <Alert {...msg} />}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={save} disabled={!!busy || (!token && !accountId)}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button className="btn-secondary" onClick={test} disabled={!!busy || !item.hasToken}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        {item.hasToken && <button className="btn-danger ml-auto" onClick={remove} disabled={!!busy}>Remove</button>}
      </div>
      {dryRun && item.status === 'connected' && <p className="hint">DRY_RUN is on: sends are logged, not posted. Set DRY_RUN=false in .env to go live.</p>}
    </section>
  );
}

export default function ConnectionsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<Resp>('/integrations').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <p className="text-red-300">{err}</p>;
  if (!data) return <p className="text-sand">Loading…</p>;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Connections</h1>
        <p className="text-sm text-cream-200/70">Official Meta APIs only · Graph {data.graphVersion} · {data.dryRun ? 'DRY RUN (nothing is posted)' : 'LIVE'}</p>
      </div>
      {data.dryRun && <Alert kind="warning" title="DRY_RUN=true – publishers only log. Connect both channels, run Test connection, then set DRY_RUN=false to go live." />}
      <div className="grid gap-5 lg:grid-cols-2">
        {data.items.map((i) => <ConnectionCard key={i.channel} item={i} onChange={load} dryRun={data.dryRun} />)}
      </div>
      <section className="card space-y-2 text-sm">
        <h2 className="card-title">Webhooks</h2>
        <p className="text-cream-200/80">In the Meta app dashboard, subscribe these callback URLs with the verify token from <code className="font-mono text-xs">META_WEBHOOK_VERIFY_TOKEN</code>. Signatures are checked with <code className="font-mono text-xs">META_APP_SECRET</code>.</p>
        <ul className="space-y-1 font-mono text-xs text-peach">
          <li>{origin}/api/v1/webhooks/whatsapp <span className="text-sand">(fields: messages)</span></li>
          <li>{origin}/api/v1/webhooks/instagram <span className="text-sand">(fields: messages – Phase 5)</span></li>
        </ul>
        <p className="hint">{data.webhooksConfigured ? 'App secret and verify token are configured.' : 'META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN are not set – webhooks will be rejected.'} JOIN and STOP keywords from customers are handled automatically.</p>
      </section>
    </div>
  );
}
