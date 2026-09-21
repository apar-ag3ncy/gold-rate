'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/Shell';
import { CardSkeleton, ErrorState } from '@/components/ui';

type Channels = { igFeed: boolean; igStory: boolean; waCustomers: boolean };
type Ibja = { enabled: boolean; autoDraft: boolean; autoApprove: boolean; draftFor: 'today' | 'tomorrow'; preferSession: 'AM' | 'PM' };
type Settings = { automationOn: boolean; sendTime: string; cutoffTime: string; channels: Channels; ibja: Ibja; adminAlerts: { emails: string[] } };
type Integration = { channel: 'instagram' | 'whatsapp'; status: string; hasToken: boolean; tokenTail?: string; accountId?: string; phoneNumberId?: string; displayName?: string; lastHealthCheck?: string; lastError?: string };
type Subscriber = { id: string; phoneMasked: string; name?: string; status: string };
type Msg = { kind: 'error' | 'warning' | 'success'; title: string; items?: string[] } | null;

function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 rounded-2xl border border-cream-200/12 bg-cream/[0.04] px-4 py-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span><span className="block text-sm font-medium text-cream">{label}</span>{hint && <span className="hint block">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-copper' : 'bg-cream/20'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-cream shadow transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="card space-y-3"><div><h2 className="card-title">{title}</h2>{sub && <p className="hint mt-1">{sub}</p>}</div>{children}</section>;
}

export default function AutomationPage() {
  const { me } = useSession();
  const admin = me?.role === 'admin';
  const [s, setS] = useState<Settings | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [subs, setSubs] = useState<{ counts: { active: number; total: number }; items: Subscriber[] } | null>(null);

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      const [st, ig, su] = await Promise.all([api<{ settings: Settings }>('/settings'), api<{ items: Integration[]; dryRun: boolean }>('/integrations'), api<{ counts: { active: number; total: number }; items: Subscriber[] }>('/subscribers?status=active&limit=500')]);
      setS(st.settings); setIntegrations(ig.items); setDryRun(ig.dryRun); setSubs(su); setDirty(false);
    } catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = (p: Partial<Settings>) => { setS((x) => (x ? { ...x, ...p } : x)); setDirty(true); };
  async function save() {
    if (!s) return;
    setBusy(true); setMsg(null); setFieldErrors({});
    try {
      const body = { automationOn: s.automationOn, sendTime: s.sendTime, cutoffTime: s.cutoffTime, channels: s.channels,
        ibja: { enabled: s.ibja.enabled, autoDraft: s.ibja.autoDraft, autoApprove: s.ibja.autoApprove, draftFor: s.ibja.draftFor, preferSession: s.ibja.preferSession },
        adminAlerts: { emails: s.adminAlerts.emails } };
      const r = await api<{ settings: Settings }>('/settings', { method: 'PUT', body });
      setS(r.settings); setDirty(false); setMsg({ kind: 'success', title: 'Saved.' });
    } catch (e) { if (e instanceof ApiError) { setFieldErrors(e.details?.fields ?? {}); setMsg({ kind: 'error', title: e.message, items: e.details?.errors }); } else setMsg({ kind: 'error', title: 'Could not reach the server' }); }
    finally { setBusy(false); }
  }

  if (loadErr) return <ErrorState message={`Could not load automation settings: ${loadErr}`} retry={load} />;
  if (!s) return <div className="space-y-4"><CardSkeleton lines={4} /><CardSkeleton lines={4} /></div>;
  const err = (k: string) => fieldErrors[k] ? <p className="mt-1 text-xs text-red-300">{fieldErrors[k]}</p> : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="page-title">Automation</h1><p className="text-sm text-cream-200/70">What gets posted, when, and where. Only an approved rate for the day is ever sent.</p></div>
        {admin && <button className="btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>}
      </div>
      {!admin && <Alert kind="warning" title="Only an admin can change these settings." />}
      {dryRun && <Alert kind="warning" title="Dry run is ON on the server – posts are simulated, nothing reaches Instagram or WhatsApp." />}
      {msg && <Alert {...msg} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Daily posting" sub="The approved rate is posted automatically at the send time. If nothing is approved by the cut-off, nothing is posted.">
          <Toggle on={s.automationOn} disabled={!admin} onChange={(v) => patch({ automationOn: v })} label="Automation" hint={s.automationOn ? 'ON – posts the approved rate every day' : 'OFF – nothing is posted automatically'} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="sendTime">Send time (IST)</label><input id="sendTime" type="time" className="input" value={s.sendTime} disabled={!admin} onChange={(e) => patch({ sendTime: e.target.value })} />{err('sendTime')}</div>
            <div><label className="label" htmlFor="cutoffTime">Cut-off (IST)</label><input id="cutoffTime" type="time" className="input" value={s.cutoffTime} disabled={!admin} onChange={(e) => patch({ cutoffTime: e.target.value })} />{err('cutoffTime')}</div>
          </div>
          <Toggle on={s.channels.igFeed} disabled={!admin} onChange={(v) => patch({ channels: { ...s.channels, igFeed: v } })} label="Instagram post" />
          <Toggle on={s.channels.igStory} disabled={!admin} onChange={(v) => patch({ channels: { ...s.channels, igStory: v } })} label="Instagram story" />
          <Toggle on={s.channels.waCustomers} disabled={!admin} onChange={(v) => patch({ channels: { ...s.channels, waCustomers: v } })} label="WhatsApp message to customers" hint={subs ? `${subs.counts.active} active recipient${subs.counts.active === 1 ? '' : 's'}` : undefined} />
          <div><label className="label" htmlFor="alertEmail">Alert email <span className="font-normal text-sand">(told when a post fails or no rate is approved)</span></label>
            <input id="alertEmail" type="email" className="input" placeholder="you@example.com" value={s.adminAlerts.emails[0] ?? ''} disabled={!admin} onChange={(e) => patch({ adminAlerts: { emails: e.target.value.trim() ? [e.target.value.trim()] : [] } })} />{err('adminAlerts.emails')}</div>
        </Section>

        <Section title="IBJA rates" sub="Official IBJA benchmark (999 → 24K, 916 → 22K, 750 → 18K, per-gram = per-10 g ÷ 10). It can fill the form or draft tomorrow's rate; approval still decides what is posted.">
          <Toggle on={s.ibja.enabled} disabled={!admin} onChange={(v) => patch({ ibja: { ...s.ibja, enabled: v, autoDraft: v && s.ibja.autoDraft, autoApprove: v && s.ibja.autoApprove } })} label="Fetch IBJA rates" hint="Twice a day (12:40 and 18:40 IST) – shown on the Rate page" />
          <Toggle on={s.ibja.autoDraft} disabled={!admin || !s.ibja.enabled} onChange={(v) => patch({ ibja: { ...s.ibja, autoDraft: v, autoApprove: v && s.ibja.autoApprove } })} label="Auto-draft from IBJA" hint="Saves the IBJA rate as a draft you still approve" />
          <Toggle on={s.ibja.autoApprove} disabled={!admin || !s.ibja.autoDraft} onChange={(v) => patch({ ibja: { ...s.ibja, autoApprove: v } })} label="Auto-approve the draft" hint="Posts the IBJA rate without a manual approve. Off = safest." />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="draftFor">Draft for</label>
              <select id="draftFor" className="input" value={s.ibja.draftFor} disabled={!admin || !s.ibja.autoDraft} onChange={(e) => patch({ ibja: { ...s.ibja, draftFor: e.target.value as Ibja['draftFor'] } })}><option value="tomorrow">Tomorrow</option><option value="today">Today</option></select></div>
            <div><label className="label" htmlFor="preferSession">Prefer session</label>
              <select id="preferSession" className="input" value={s.ibja.preferSession} disabled={!admin || !s.ibja.enabled} onChange={(e) => patch({ ibja: { ...s.ibja, preferSession: e.target.value as Ibja['preferSession'] } })}><option value="PM">Evening (PM)</option><option value="AM">Morning (AM)</option></select></div>
          </div>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {integrations?.map((it) => <ConnectionCard key={it.channel} it={it} admin={admin} onChange={(items) => setIntegrations(items)} />)}
      </div>

      <Recipients admin={admin} subs={subs} reload={load} />
    </div>
  );
}

function ConnectionCard({ it, admin, onChange }: { it: Integration; admin: boolean; onChange: (items: Integration[]) => void }) {
  const [token, setToken] = useState(''); const [accountId, setAccountId] = useState(it.accountId ?? ''); const [phoneNumberId, setPhoneNumberId] = useState(it.phoneNumberId ?? '');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  const ig = it.channel === 'instagram';
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, string> = ig ? { accountId } : { phoneNumberId };
      if (token.trim()) body.accessToken = token.trim();
      const r = await api<{ item: Integration }>(`/integrations/${it.channel}`, { method: 'PUT', body });
      setToken(''); setMsg({ kind: 'success', title: `Saved (token ends …${r.item.tokenTail ?? ''}). Click Test to check it works.` });
      const all = await api<{ items: Integration[] }>('/integrations'); onChange(all.items);
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message, items: (e as ApiError).details?.errors }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMsg(null);
    try { const r = await api<{ result: { ok: boolean; message?: string; error?: string; displayName?: string }; items: Integration[] }>(`/integrations/${it.channel}/test`, { method: 'POST' }); onChange(r.items); setMsg(r.result.ok ? { kind: 'success', title: `Connected${r.result.displayName ? ` as ${r.result.displayName}` : ''}.` } : { kind: 'error', title: r.result.error ?? r.result.message ?? 'Connection failed' }); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove the ${ig ? 'Instagram' : 'WhatsApp'} connection? Posting to it will stop until you add it again.`)) return;
    setBusy(true); try { await api(`/integrations/${it.channel}`, { method: 'DELETE' }); const all = await api<{ items: Integration[] }>('/integrations'); onChange(all.items); setAccountId(''); setPhoneNumberId(''); setMsg({ kind: 'warning', title: 'Removed.' }); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); } finally { setBusy(false); }
  }
  const tone = it.status === 'connected' ? 'text-emerald-200' : it.status === 'error' ? 'text-red-300' : 'text-sand';
  return (
    <Section title={ig ? 'Instagram connection' : 'WhatsApp connection'} sub={ig ? 'Meta Graph API – Instagram professional account linked to a Facebook Page.' : 'WhatsApp Cloud API – business phone number in Meta Business Manager.'}>
      <p className={`text-sm ${tone}`}>{it.status === 'connected' ? `Connected${it.displayName ? ` · ${it.displayName}` : ''}` : it.status === 'error' ? `Error: ${it.lastError ?? 'unknown'}` : it.hasToken ? 'Saved, not tested yet' : 'Not connected'}{it.lastHealthCheck && <span className="hint block">Last checked {fmtDateTime(it.lastHealthCheck)}</span>}</p>
      <div><label className="label" htmlFor={`${it.channel}-token`}>Access token {it.hasToken && <span className="font-normal text-sand">(saved, ends …{it.tokenTail}; paste a new one to replace)</span>}</label>
        <input id={`${it.channel}-token`} type="password" autoComplete="off" className="input" placeholder={it.hasToken ? '••••••••' : 'Paste the long-lived token'} value={token} disabled={!admin} onChange={(e) => setToken(e.target.value)} /></div>
      <div><label className="label" htmlFor={`${it.channel}-id`}>{ig ? 'Instagram account ID' : 'Phone number ID'}</label>
        <input id={`${it.channel}-id`} inputMode="numeric" className="input" value={ig ? accountId : phoneNumberId} disabled={!admin} onChange={(e) => (ig ? setAccountId : setPhoneNumberId)(e.target.value)} /></div>
      {msg && <Alert {...msg} />}
      {admin && <div className="flex flex-wrap gap-2"><button className="btn-primary btn-sm" onClick={save} disabled={busy}>Save</button><button className="btn-secondary btn-sm" onClick={test} disabled={busy || !it.hasToken}>Test</button>{it.hasToken && <button className="btn-danger btn-sm ml-auto" onClick={remove} disabled={busy}>Remove</button>}</div>}
    </Section>
  );
}

function Recipients({ admin, subs, reload }: { admin: boolean; subs: { counts: { active: number; total: number }; items: Subscriber[] } | null; reload: () => Promise<void> }) {
  const [phone, setPhone] = useState(''); const [name, setName] = useState(''); const [bulk, setBulk] = useState(''); const [showBulk, setShowBulk] = useState(false);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null); const [open, setOpen] = useState(false);
  async function add() {
    setBusy(true); setMsg(null);
    try { await api('/subscribers', { method: 'POST', body: { phone, optInSource: 'manual', name: name || undefined } }); setPhone(''); setName(''); await reload(); setMsg({ kind: 'success', title: 'Added.' }); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message, items: (e as ApiError).details?.errors }); } finally { setBusy(false); }
  }
  async function importBulk() {
    setBusy(true); setMsg(null);
    try {
      // Pasted lines are "number" or "number, name"; every pasted number is treated as a manual opt-in.
      const csv = 'phone,name,optInSource\n' + bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [ph, ...rest] = l.split(','); return `${ph.trim()},${rest.join(' ').trim().replace(/,/g, ' ')},manual`; }).join('\n');
      const r = await api<{ added: number; reactivated: number; errors: { row: number; problem: string }[] }>('/subscribers/import', { method: 'POST', body: { csv } });
      setBulk(''); setShowBulk(false); await reload();
      setMsg({ kind: r.errors.length ? 'warning' : 'success', title: `Added ${r.added}${r.reactivated ? `, re-activated ${r.reactivated}` : ''}${r.errors.length ? `, ${r.errors.length} skipped` : ''}.`, items: r.errors.slice(0, 10).map((x) => `Line ${x.row - 1}: ${x.problem}`) });
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); } finally { setBusy(false); }
  }
  async function remove(sub: Subscriber) {
    if (!window.confirm(`Remove ${sub.name ? `${sub.name} (${sub.phoneMasked})` : sub.phoneMasked} from the WhatsApp list?`)) return;
    try { await api(`/subscribers/${sub.id}`, { method: 'DELETE' }); await reload(); } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
  }
  return (
    <Section title="WhatsApp recipients" sub="Customers who agreed to receive the daily rate on WhatsApp. Only add numbers that opted in.">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{subs ? <><span className="font-semibold">{subs.counts.active}</span> active recipient{subs.counts.active === 1 ? '' : 's'}</> : 'Loading…'}</p>
        {subs && subs.items.length > 0 && <button className="btn-secondary btn-sm" onClick={() => setOpen(!open)}>{open ? 'Hide list' : 'Show list'}</button>}
      </div>
      {open && subs && (
        <ul className="max-h-72 divide-y divide-cream-200/10 overflow-y-auto rounded-2xl border border-cream-200/12">
          {subs.items.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span>{x.name && <span className="mr-2">{x.name}</span>}<span className="kbd-money text-sand">{x.phoneMasked}</span></span>{admin && <button className="btn-danger btn-sm" onClick={() => remove(x)}>Remove</button>}</li>)}
        </ul>
      )}
      {admin && (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className="input" inputMode="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone number" />
            <input className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <button className="btn-primary" onClick={add} disabled={busy || phone.trim().length < 5}>Add</button>
          </div>
          <button type="button" className="text-xs text-copper underline-offset-2 hover:underline" onClick={() => setShowBulk(!showBulk)}>{showBulk ? 'Hide bulk paste' : 'Paste many numbers at once'}</button>
          {showBulk && <div className="space-y-2"><textarea className="input min-h-28 font-mono text-sm" placeholder={'One per line: number, name\n+919876543210, Meena\n+919812345678'} value={bulk} onChange={(e) => setBulk(e.target.value)} /><button className="btn-secondary btn-sm" onClick={importBulk} disabled={busy || !bulk.trim()}>Add all</button></div>}
        </>
      )}
      {msg && <Alert {...msg} />}
    </Section>
  );
}
