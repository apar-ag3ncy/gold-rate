'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, buildCaption, DEFAULT_CAPTION_TEMPLATE, istDate, rateFormIsDirty, rateToForm, typedToNumber } from '@chheda/shared';
import { api, ApiError, channelLabel, fmtDate, fmtTime, perGram } from '@/lib/api';
import { useSession } from '@/components/Shell';
import { Alert } from '@/components/Alert';
import { StatusBadge } from '@/components/StatusBadge';
import { CardSkeleton, ErrorState, LoadingGuard } from '@/components/ui';

type Rate = { date: string; k24: number; k22: number; k18: number; extraPurities: { label: string; value: number }[]; status: string; source?: string; ibja?: { rateDate: string; session: string }; overrideReason?: string; creativeUrls?: { feed?: string; story?: string }; caption?: string; validation: { warnings: string[] } };
type Extra = { label: string; value: string };
type Form = { k24: string; k22: string; k18: string; extraPurities: Extra[]; overrideReason: string };
type Preview = { feedUrl: string; storyUrl: string; caption: string; saved: boolean; warnings?: string[] };
type Ibja = { latest: { rateDate: string; session: 'AM' | 'PM'; perGram: { k24: string; k22: string; k18: string }; per10g: Record<string, string>; source: string; fetchedAt: string } | null; settings: { enabled: boolean; autoDraft: boolean; autoApprove: boolean }; lastFetch: { ok: boolean; error?: string } | null };
type Summary = { today: string; todayRate: Rate | null };
type Cfg = { automationOn: boolean; sendTime: string; cutoffTime: string };
type Day = { status: string; reason?: string; sentAt?: string } | null;
type Plan = { dryRun: boolean; canSend: boolean; reason?: string; subscribers: number; channels: { channel: string; enabled: boolean; alreadySent: boolean; recipients?: number; manual?: boolean }[] };
type SendResult = { action: string; reason?: string; channels?: Record<string, string> };
const empty: Form = { k24: '', k22: '', k18: '', extraPurities: [], overrideReason: '' };

function RateScreen() {
  const params = useSearchParams(); const router = useRouter();
  const today = istDate();
  const [date, setDate] = useState(params.get('date') ?? today);
  const [form, setForm] = useState<Form>(empty);
  const [rate, setRate] = useState<Rate | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'error' | 'warning' | 'success'; title: string; items?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadErr, setLoadErr] = useState('');
  const [template, setTemplate] = useState(DEFAULT_CAPTION_TEMPLATE);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [day, setDay] = useState<Day>(null);
  const [ibja, setIbja] = useState<Ibja | null>(null);
  const [ibjaBusy, setIbjaBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sending, setSending] = useState(false);
  const { me } = useSession();

  const loadIbja = useCallback(() => api<Ibja>('/ibja/latest').then(setIbja).catch(() => {}), []);
  const loadStatus = useCallback(() => Promise.all([api<Summary>('/rates/summary'), api<{ settings: Cfg & { captionTemplate: string } }>('/settings'), api<{ day: Day }>('/deliveries')])
    .then(([s, c, d]) => { setSummary(s); setCfg(c.settings); setTemplate(c.settings.captionTemplate); setDay(d.day); }).catch(() => {}), []);
  const load = useCallback(async (d: string) => {
    setMsg(null); setFieldErrors({}); setPreview(null); setLoadState('loading'); setLoadErr('');
    try {
      const r = await api<{ rate: Rate }>(`/rates/${d}`);
      setRate(r.rate); setForm(rateToForm(r.rate as any));
      if (r.rate.creativeUrls?.feed && r.rate.caption) setPreview({ feedUrl: r.rate.creativeUrls.feed, storyUrl: r.rate.creativeUrls.story!, caption: r.rate.caption, saved: true });
      setLoadState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setRate(null); setForm(empty); setLoadState('ready'); }
      else { setLoadState('error'); setLoadErr((e as Error).message); }
    }
  }, []);
  useEffect(() => { loadIbja(); loadStatus(); }, [loadIbja, loadStatus]);
  useEffect(() => { load(date); router.replace(`/?date=${date}`); }, [date, load, router]);
  const canSendNow = me?.role === 'admin' && date === today && rate?.status === 'approved';
  useEffect(() => { if (canSendNow) api<Plan>('/send/plan').then(setPlan).catch(() => setPlan(null)); else setPlan(null); }, [canSendNow, rate?.status]);

  const locked = rate?.status === 'sent'; const past = date < today; const readOnly = locked || past;
  const dirty = rateFormIsDirty(form, rate);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true); setMsg(null); setFieldErrors({});
    try {
      const r = await api<{ rate: Rate; warnings: string[] }>(`/rates/${date}`, { method: 'PUT', body: form });
      setRate(r.rate); setForm(rateToForm(r.rate as any)); setPreview(null);
      setMsg(r.warnings.length ? { kind: 'warning', title: 'Saved. Check the warnings, then Approve.', items: r.warnings } : { kind: 'success', title: 'Saved. Now click Approve to confirm this rate.' });
      loadStatus();
    } catch (e) { if (e instanceof ApiError) { setFieldErrors(e.details?.fields ?? {}); setMsg({ kind: 'error', title: e.message, items: e.details?.errors }); } else setMsg({ kind: 'error', title: 'Could not reach the server' }); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!rate || !window.confirm(`Approve for ${fmtDate(date)}?\n\n24K ${perGram(rate.k24)}\n22K ${perGram(rate.k22)}\n18K ${perGram(rate.k18)}\n\nAutomation will post this at the scheduled time.`)) return;
    setBusy(true);
    try { const r = await api<{ rate: Rate }>(`/rates/${date}/approve`, { method: 'POST' }); setRate(r.rate); setMsg({ kind: 'success', title: 'Approved. It will be posted automatically at the send time.' }); loadStatus(); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message, items: (e as ApiError).details?.errors }); } finally { setBusy(false); }
  }
  async function cancel() {
    const reason = window.prompt('Why are you cancelling this rate? (Nothing will be posted for this date)'); if (!reason) return;
    try { const r = await api<{ rate: Rate }>(`/rates/${date}/cancel`, { method: 'POST', body: { reason } }); setRate(r.rate); setMsg({ kind: 'warning', title: 'Cancelled. Nothing will be posted for this date.' }); loadStatus(); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
  }
  async function sendNow() {
    if (!rate || !plan) return;
    const targets = plan.channels.filter((c) => c.enabled && !c.manual && !c.alreadySent).map((c) => `• ${channelLabel[c.channel] ?? c.channel}${c.recipients != null ? ` (${c.recipients} numbers)` : ''}`);
    if (!targets.length) { setMsg({ kind: 'warning', title: 'Nothing to send – every channel is switched off or already sent today.' }); return; }
    if (!window.confirm(`Send today's rate now?\n\n24K ${perGram(rate.k24)}\n22K ${perGram(rate.k22)}\n18K ${perGram(rate.k18)}\n\nGoes to:\n${targets.join('\n')}${plan.dryRun ? '\n\nDRY RUN is on: this is a rehearsal, nothing is really posted.' : ''}`)) return;
    setSending(true); setMsg(null);
    try {
      const r = await api<{ dryRun: boolean; result: SendResult }>('/send/now', { method: 'POST' });
      const ch = Object.entries(r.result.channels ?? {}).map(([c, st]) => `${channelLabel[c] ?? c}: ${st}`);
      const outcome: typeof msg = r.result.action === 'sent' ? { kind: 'success', title: r.dryRun ? 'Dry run finished – nothing was really posted.' : 'Sent.', items: ch }
        : r.result.action === 'partial' ? { kind: 'warning', title: 'Sent on some channels only. Fix the failed one and press Send again – successful channels are never repeated.', items: ch }
        : r.result.action === 'already_sent' ? { kind: 'success', title: 'Already sent today on every channel.' }
        : { kind: 'error', title: r.result.reason ?? `Could not send (${r.result.action}).` };
      await load(date); loadStatus();   // load() clears the message, so show the outcome afterwards
      setMsg(outcome);
    } catch (e) { setMsg({ kind: 'error', title: e instanceof ApiError && e.status === 423 ? 'A send is already running – wait a minute and reload.' : (e as Error).message }); }
    finally { setSending(false); }
  }
  function useIbja() {
    if (!ibja?.latest) return;
    setForm({ ...form, k24: ibja.latest.perGram.k24, k22: ibja.latest.perGram.k22, k18: ibja.latest.perGram.k18 });
    setMsg({ kind: 'success', title: `Filled from IBJA ${ibja.latest.session} rate of ${fmtDate(ibja.latest.rateDate)}. Save, then Approve.` });
  }
  async function refreshIbja() {
    setIbjaBusy(true); setMsg(null);
    try { await api('/ibja/refresh', { method: 'POST' }); } catch (e) { setMsg({ kind: 'error', title: `IBJA fetch failed: ${(e as Error).message}` }); }
    finally { await loadIbja(); setIbjaBusy(false); }
  }
  async function doPreview() {
    setPreviewBusy(true); setMsg(null);
    try {
      const p = rate && !dirty && rate.status !== 'cancelled' ? await api<Preview>(`/preview/${date}`, { method: 'POST' }) : await api<Preview>('/preview', { method: 'POST', body: { date, ...form } });
      setPreview(p);
    } catch (e) { if (e instanceof ApiError) { setFieldErrors(e.details?.fields ?? {}); setMsg({ kind: 'error', title: e.message, items: e.details?.errors }); } else setMsg({ kind: 'error', title: 'Could not reach the server' }); }
    finally { setPreviewBusy(false); }
  }
  const liveCaption = useMemo(() => {
    const k24 = typedToNumber(form.k24), k22 = typedToNumber(form.k22), k18 = typedToNumber(form.k18);
    if (k24 == null || k22 == null || k18 == null) return null;
    const extras = form.extraPurities.filter((p) => p.label.trim() && typedToNumber(p.value) != null).map((p) => ({ label: p.label.trim(), value: typedToNumber(p.value)! }));
    try { return buildCaption(template, { date, k24, k22, k18, extraPurities: extras }); } catch { return null; }
  }, [form, date, template]);

  const todayStatus = (() => {
    const t = summary?.todayRate; if (!cfg) return null;
    if (day?.status === 'sent' || t?.status === 'sent') return { tone: 'ok', text: `Today's rate was posted${day?.sentAt ? ` at ${fmtTime(day.sentAt)}` : ''}.` };
    if (t?.status === 'approved') return { tone: 'ok', text: `Today's rate is approved – ${cfg.automationOn ? `posts at ${cfg.sendTime} IST` : 'automation is OFF, nothing will be posted'}.` };
    if (t?.status === 'draft') return { tone: 'warn', text: `Today's rate is saved but not approved. Approve before ${cfg.cutoffTime} IST.` };
    return { tone: 'bad', text: `Today's rate is not entered. Nothing is posted until you enter and approve it.` };
  })();
  const placeholders: Record<'k24' | 'k22' | 'k18', string> = { k24: 'e.g. 15305.6', k22: 'e.g. 14019.9', k18: 'e.g. 11479.2' };
  const field = (k: 'k24' | 'k22' | 'k18', label: string, hero = false) => (
    <div className={`rounded-2xl border p-3.5 ${fieldErrors[k] ? 'border-red-300/50 bg-red-500/10' : hero ? 'border-copper/45 bg-copper/10' : 'border-cream-200/12 bg-cream/[0.04]'}`}>
      <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-copper" htmlFor={k}>{label}<span className="font-normal normal-case tracking-normal text-sand">per gram</span></label>
      <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-sand">₹</span>
        <input id={k} inputMode="decimal" placeholder={placeholders[k]} className={`input kbd-money pl-8 pr-9 text-lg font-semibold ${fieldErrors[k] ? 'border-red-400' : ''}`} value={form[k]} onChange={set(k)} disabled={readOnly} aria-invalid={!!fieldErrors[k]} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-sand">/g</span></div>
      {fieldErrors[k] && <p className="mt-1.5 text-xs text-red-300">{fieldErrors[k]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      {todayStatus && <div role="status" className={`rounded-2xl border px-4 py-3 text-sm ${todayStatus.tone === 'ok' ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-50' : todayStatus.tone === 'warn' ? 'border-amber-300/30 bg-amber-400/10 text-amber-50' : 'border-red-300/30 bg-red-500/10 text-red-100'}`}>{todayStatus.text}{day?.reason && day.status !== 'sent' && <span className="block text-xs opacity-80">{day.reason}</span>}</div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="card space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h1 className="page-title">Gold rate</h1><p className="text-sm text-cream-200/70">Type the per-gram rate for each karat, or use the IBJA rate. Values are posted exactly as entered.</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cream-200/12 bg-cream/[0.04] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label mb-1 text-xs" htmlFor="date">Rate for</label><input id="date" type="date" className="input py-1.5" min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
              <div className="flex gap-1.5 pb-0.5">
                <button type="button" className={`btn-secondary btn-sm ${date === today ? 'ring-2 ring-copper/60' : ''}`} onClick={() => setDate(today)}>Today</button>
                <button type="button" className={`btn-secondary btn-sm ${date === addDays(today, 1) ? 'ring-2 ring-copper/60' : ''}`} onClick={() => setDate(addDays(today, 1))}>Tomorrow</button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm"><span className="font-serif text-base">{fmtDate(date)}</span><StatusBadge status={rate?.status ?? 'missing'} />{rate?.source === 'ibja' && <span className="chip">from IBJA</span>}</div>
          </div>
          {loadState === 'error' && <ErrorState message={`Could not load the rate for ${fmtDate(date)}: ${loadErr}`} retry={() => load(date)} />}
          {locked && <Alert kind="warning" title="This rate has been posted and is locked." />}
          {past && !locked && <Alert kind="warning" title="Past dates are read-only." />}
          <div className="grid gap-3 sm:grid-cols-3">{field('k24', '24K Gold', true)}{field('k22', '22K Gold')}{field('k18', '18K Gold')}</div>
          <div className="rounded-2xl border border-cream-200/12 bg-cream/[0.04] p-3.5">
            <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-copper">Other purities <span className="font-normal normal-case tracking-normal text-sand">optional</span></p>
              <button type="button" className="btn-secondary btn-sm" disabled={readOnly || form.extraPurities.length >= 10} onClick={() => setForm({ ...form, extraPurities: [...form.extraPurities, { label: '', value: '' }] })}>+ Add</button></div>
            {form.extraPurities.map((p, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                <input className="input" placeholder="Label e.g. 14K" value={p.label} disabled={readOnly} onChange={(e) => { const x = [...form.extraPurities]; x[i] = { ...p, label: e.target.value }; setForm({ ...form, extraPurities: x }); }} />
                <input className="input kbd-money" inputMode="decimal" placeholder="₹ per gram" value={p.value} disabled={readOnly} onChange={(e) => { const x = [...form.extraPurities]; x[i] = { ...p, value: e.target.value }; setForm({ ...form, extraPurities: x }); }} />
                <button type="button" className="btn-danger btn-sm" disabled={readOnly} aria-label="Remove" onClick={() => setForm({ ...form, extraPurities: form.extraPurities.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            {Object.entries(fieldErrors).filter(([k]) => k.startsWith('extraPurities')).map(([k, v]) => <p key={k} className="text-xs text-red-300">{k}: {v}</p>)}
          </div>
          <div><label className="label" htmlFor="ov">Reason <span className="font-normal text-sand">(only needed if the rate changed a lot since yesterday)</span></label><input id="ov" className="input" value={form.overrideReason} onChange={set('overrideReason')} disabled={readOnly} maxLength={300} /></div>
          {msg && <Alert {...msg} />}
          <div className="divider-gold" />
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : rate ? 'Update rate' : 'Save rate'}</button>}
            {!readOnly && rate?.status !== 'approved' && <button className="btn-secondary" onClick={approve} disabled={busy || rate?.status !== 'draft' || dirty} title={dirty ? 'Save your changes first' : undefined}>✓ Approve</button>}
            {canSendNow && <button className="btn-primary" onClick={sendNow} disabled={sending || busy || dirty || !plan} title={dirty ? 'Save your changes first' : undefined}>{sending ? 'Sending…' : plan?.dryRun ? 'Send now (dry run)' : 'Send now'}</button>}
            <button className="btn-secondary" onClick={doPreview} disabled={previewBusy || busy || (past && !rate)}>{previewBusy ? 'Rendering…' : 'Preview post'}</button>
            {!readOnly && rate && rate.status !== 'cancelled' && <button className="btn-danger ml-auto" onClick={cancel} disabled={busy}>Cancel rate</button>}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="card">
            <div className="mb-2 flex items-center justify-between gap-2"><h2 className="card-title">IBJA rate</h2>{ibja?.latest && <span className="chip">{ibja.latest.session} · {fmtDate(ibja.latest.rateDate)}</span>}</div>
            {!ibja ? <CardSkeleton lines={3} /> : !ibja.settings.enabled ? <p className="hint">IBJA is switched off in Automation.</p> : !ibja.latest ? <p className="hint">No IBJA rate fetched yet.{ibja.lastFetch && !ibja.lastFetch.ok && ` Last attempt failed: ${ibja.lastFetch.error}`}</p> : (
              <>
                <dl className="space-y-1.5">
                  {([['24K', ibja.latest.perGram.k24, '999'], ['22K', ibja.latest.perGram.k22, '916'], ['18K', ibja.latest.perGram.k18, '750']] as const).map(([k, v, p]) => (
                    <div key={k} className="flex items-center justify-between rounded-xl border border-cream-200/15 bg-emerald-950/40 px-3 py-2"><dt className="text-xs uppercase tracking-wider text-copper">{k} <span className="text-sand">({p})</span></dt><dd className="kbd-money font-bold">₹{v}/g</dd></div>
                  ))}
                </dl>
                <p className="hint mt-2">IBJA per-10 g ÷ 10, exact · fetched {fmtTime(ibja.latest.fetchedAt)}{ibja.settings.autoDraft && ' · auto-draft ON'}</p>
                {!readOnly && <div className="mt-3 flex flex-wrap gap-2"><button className="btn-primary btn-sm" onClick={useIbja}>Use IBJA rates</button><button className="btn-secondary btn-sm" onClick={refreshIbja} disabled={ibjaBusy}>{ibjaBusy ? 'Fetching…' : 'Refresh'}</button></div>}
              </>
            )}
          </section>
          <section className="card"><h2 className="card-title mb-2">Message</h2><pre className="whitespace-pre-wrap rounded-xl border border-cream-200/12 bg-cream/[0.04] p-3 font-sans text-sm leading-relaxed">{liveCaption ?? 'Enter 24K, 22K and 18K to see the message.'}</pre></section>
        </aside>
      </div>

      {preview && (
        <section className="glass-dark space-y-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2"><h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-peach">Post preview{!preview.saved && ' · unsaved values'}</h2><button className="btn-secondary btn-sm" onClick={() => setPreview(null)}>Close</button></div>
          <div className="grid gap-5 md:grid-cols-[1fr_auto]">
            <img src={preview.feedUrl} alt="Instagram post" className="w-full max-w-md rounded-xl border border-white/10 shadow-2xl" />
            <img src={preview.storyUrl} alt="Instagram story" className="mx-auto w-full max-w-[220px] rounded-xl border border-white/10 shadow-2xl" />
          </div>
        </section>
      )}
    </div>
  );
}

export default function Page() { return <Suspense fallback={<LoadingGuard><CardSkeleton lines={8} /></LoadingGuard>}><RateScreen /></Suspense>; }
