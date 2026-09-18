'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, buildCaption, DEFAULT_CAPTION_TEMPLATE, istDate } from '@chheda/shared';
import { api, ApiError, fmtDate, inr } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { CardSkeleton } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import type { Rate } from '@/components/RateCard';
import type { Delivery } from '@/components/DeliveryList';

type Extra = { label: string; value: string };
type Form = { k24: string; k22: string; k18: string; extraPurities: Extra[]; overrideReason: string };
type Preview = { feedUrl: string; storyUrl: string; caption: string; saved: boolean; warnings?: string[] };
type TestResult = { delivery: Delivery; dryRun: boolean; rendered: { feedUrl: string; storyUrl: string; caption: string } };
const empty: Form = { k24: '', k22: '', k18: '', extraPurities: [], overrideReason: '' };
const plain = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim());

function Steps({ current }: { current: number }) {
  const steps = ['Enter', 'Save', 'Preview', 'Approve', 'Test send'];
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'now' : 'todo';
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition ${state === 'now' ? 'border-copper/70 bg-copper/20 text-cream'
              : state === 'done' ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100' : 'border-cream-200/12 bg-cream/[0.04] text-sand'}`}>
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold ${state === 'done' ? 'bg-emerald-500 text-white' : state === 'now' ? 'bg-cream text-emerald-100' : 'bg-cream/15 text-cream-200'}`}>{state === 'done' ? '✓' : n}</span>{s}
            </span>
            {i < steps.length - 1 && <span className="text-cream-200/80">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function RateForm() {
  const params = useSearchParams();
  const router = useRouter();
  const today = istDate();
  const [date, setDate] = useState(params.get('date') ?? addDays(today, 1));
  const [form, setForm] = useState<Form>(empty);
  const [rate, setRate] = useState<Rate | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'error' | 'warning' | 'success'; title: string; items?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_CAPTION_TEMPLATE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => { api<{ settings: { captionTemplate: string } }>('/settings').then((r) => setTemplate(r.settings.captionTemplate)).catch(() => {}); }, []);

  const load = useCallback(async (d: string) => {
    setMsg(null); setFieldErrors({}); setPreview(null); setTestResult(null);
    try {
      const r = await api<{ rate: Rate }>(`/rates/${d}`);
      setRate(r.rate);
      setForm({
        k24: String(r.rate.k24), k22: String(r.rate.k22), k18: String(r.rate.k18),
        extraPurities: r.rate.extraPurities.map((p) => ({ label: p.label, value: String(p.value) })),
        overrideReason: (r.rate as any).overrideReason ?? '',
      });
      const c = (r.rate as any).creativeUrls;
      if (c?.feed && (r.rate as any).caption) setPreview({ feedUrl: c.feed, storyUrl: c.story, caption: (r.rate as any).caption, saved: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setRate(null); setForm(empty); }
      else setMsg({ kind: 'error', title: (e as Error).message });
    }
  }, []);

  useEffect(() => { load(date); router.replace(`/rates?date=${date}`); }, [date, load, router]);

  const locked = rate?.status === 'sent';
  const past = date < today;
  const readOnly = locked || past;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true); setMsg(null); setFieldErrors({});
    try {
      const r = await api<{ rate: Rate; warnings: string[] }>(`/rates/${date}`, { method: 'PUT', body: form });
      setRate(r.rate); setPreview(null); setTestResult(null);
      setMsg(r.warnings.length
        ? { kind: 'warning', title: 'Saved as draft – please review, then approve.', items: r.warnings }
        : { kind: 'success', title: 'Saved as draft. Preview the image, check the values, then Approve.' });
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.details?.fields ?? {});
        setMsg({ kind: 'error', title: e.message, items: e.details?.errors });
      } else setMsg({ kind: 'error', title: 'Could not reach the server' });
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!rate) return;
    const ok = window.confirm(`Approve these rates for ${fmtDate(date)}?\n\n24K ${inr(rate.k24)}/g\n22K ${inr(rate.k22)}/g\n18K ${inr(rate.k18)}/g\n\nThey will be sent automatically at the scheduled time.`);
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ rate: Rate }>(`/rates/${date}/approve`, { method: 'POST' });
      setRate(r.rate);
      setMsg({ kind: 'success', title: 'Approved. This rate will be sent at the scheduled time.' });
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message, items: (e as ApiError).details?.errors }); }
    finally { setBusy(false); }
  }

  async function cancel() {
    const reason = window.prompt('Why are you cancelling this rate? (Nothing will be sent for this date)');
    if (!reason) return;
    try {
      const r = await api<{ rate: Rate }>(`/rates/${date}/cancel`, { method: 'POST', body: { reason } });
      setRate(r.rate); setMsg({ kind: 'warning', title: 'Rate cancelled. Nothing will be sent for this date.' });
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
  }

  const dirty = !!rate && (String(rate.k24) !== form.k24 || String(rate.k22) !== form.k22 || String(rate.k18) !== form.k18
    || JSON.stringify(rate.extraPurities.map((p) => ({ label: p.label, value: String(p.value) }))) !== JSON.stringify(form.extraPurities));
  const savedUsable = !!rate && !dirty && rate.status !== 'cancelled';

  async function doPreview() {
    setPreviewBusy(true); setMsg(null); setFieldErrors({}); setCopied(false);
    try {
      const p = savedUsable
        ? await api<Preview>(`/preview/${date}`, { method: 'POST' })
        : await api<Preview>('/preview', { method: 'POST', body: { date, ...form } });
      setPreview(p);
      if (!p.saved) setMsg({ kind: 'warning', title: 'Preview of UNSAVED values. Save the rate to keep them.', items: p.warnings });
      setTimeout(() => document.getElementById('preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      if (e instanceof ApiError) { setFieldErrors(e.details?.fields ?? {}); setMsg({ kind: 'error', title: e.message, items: e.details?.errors }); }
      else setMsg({ kind: 'error', title: 'Could not reach the server' });
    } finally { setPreviewBusy(false); }
  }

  async function copyCaption() {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview.caption); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy the caption:', preview.caption); }
  }

  async function testSend() {
    if (!rate) return;
    const ok = window.confirm(`Test Send for ${fmtDate(date)}?\n\nThis renders the saved rate and sends it ONLY to you (the admin). Customers never receive a test.\n\nDRY RUN is on: the send is logged, not transmitted.`);
    if (!ok) return;
    setTestBusy(true); setMsg(null);
    try {
      const r = await api<TestResult>('/send/test', { method: 'POST', body: { date } });
      setTestResult(r);
      setPreview({ feedUrl: r.rendered.feedUrl, storyUrl: r.rendered.storyUrl, caption: r.rendered.caption, saved: true });
      setMsg({ kind: 'success', title: r.dryRun ? `Test send logged (DRY RUN) – recipient: ${r.delivery.recipient}. No customers were contacted.` : `Test sent to ${r.delivery.recipient}.` });
    } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
    finally { setTestBusy(false); }
  }

  const liveCaption = useMemo(() => {
    const extras = form.extraPurities.filter((p) => p.label.trim() && plain(p.value));
    if (!plain(form.k24) || !plain(form.k22) || !plain(form.k18)) return null;
    try { return buildCaption(template, { date, k24: form.k24.trim(), k22: form.k22.trim(), k18: form.k18.trim(), extraPurities: extras.map((p) => ({ label: p.label.trim(), value: p.value.trim() })) }); }
    catch { return null; }
  }, [form, date, template]);

  const step = !rate || dirty ? (form.k24 || form.k22 || form.k18 ? 2 : 1) : rate.status === 'draft' ? (preview ? 4 : 3) : rate.status === 'approved' ? 5 : 5;

  const field = (k: 'k24' | 'k22' | 'k18', label: string, hero = false) => (
    <div className={`rounded-2xl border p-3.5 transition ${fieldErrors[k] ? 'border-red-300/50 bg-red-500/10' : hero ? 'border-copper/45 bg-copper/10' : 'border-cream-200/12 bg-cream/[0.04]'}`}>
      <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-copper" htmlFor={k}>
        {label} <span className="font-normal normal-case tracking-normal text-sand/80">per gram</span>
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-sand/80">₹</span>
        <input id={k} inputMode="decimal" placeholder="e.g. 11250" className={`input kbd-money pl-8 pr-9 text-lg font-semibold ${fieldErrors[k] ? 'border-red-400' : ''}`}
          value={form[k]} onChange={set(k)} disabled={readOnly} aria-invalid={!!fieldErrors[k]} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-sand/80">/g</span>
      </div>
      {fieldErrors[k] && <p className="mt-1.5 text-xs text-red-300">{fieldErrors[k]}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Enter Gold Rate</h1>
          <p className="text-sm text-cream-200/70">Values are published exactly as typed – nothing is calculated or rounded.</p>
        </div>
        <Steps current={step} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl surface p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label mb-1 text-xs" htmlFor="date">Rate for</label>
                <input id="date" type="date" className="input py-1.5" min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
              <div className="flex gap-1.5 pb-0.5">
                <button type="button" className={`btn-secondary btn-sm ${date === today ? 'ring-2 ring-copper/60' : ''}`} onClick={() => setDate(today)}>Today</button>
                <button type="button" className={`btn-secondary btn-sm ${date === addDays(today, 1) ? 'ring-2 ring-copper/60' : ''}`} onClick={() => setDate(addDays(today, 1))}>Tomorrow</button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-serif text-base">{fmtDate(date)}</span>
              <StatusBadge status={rate?.status ?? 'missing'} />
            </div>
          </div>

          {locked && <Alert kind="warning" title="This rate has been sent and is locked." />}
          {past && !locked && <Alert kind="warning" title="Past dates are read-only." />}

          <div className="grid gap-3 sm:grid-cols-3">
            {field('k24', '24K Gold', true)}
            {field('k22', '22K Gold')}
            {field('k18', '18K Gold')}
          </div>

          <div className="rounded-2xl surface p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-copper">Other purities <span className="font-normal normal-case tracking-normal text-sand/80">optional · up to 10</span></p>
              <button type="button" className="btn-secondary btn-sm" disabled={readOnly || form.extraPurities.length >= 10}
                onClick={() => setForm({ ...form, extraPurities: [...form.extraPurities, { label: '', value: '' }] })}>+ Add purity</button>
            </div>
            {form.extraPurities.length === 0 && <p className="hint">e.g. 14K, 20K, Platinum. Shown on the image and caption only if present.</p>}
            {form.extraPurities.map((p, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                <input className="input" placeholder="Label e.g. 14K" value={p.label} disabled={readOnly}
                  onChange={(e) => { const x = [...form.extraPurities]; x[i] = { ...p, label: e.target.value }; setForm({ ...form, extraPurities: x }); }} />
                <input className="input kbd-money" inputMode="decimal" placeholder="₹ per gram" value={p.value} disabled={readOnly}
                  onChange={(e) => { const x = [...form.extraPurities]; x[i] = { ...p, value: e.target.value }; setForm({ ...form, extraPurities: x }); }} />
                <button type="button" className="btn-danger btn-sm" disabled={readOnly} aria-label="Remove"
                  onClick={() => setForm({ ...form, extraPurities: form.extraPurities.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            {Object.entries(fieldErrors).filter(([k]) => k.startsWith('extraPurities')).map(([k, v]) => <p key={k} className="text-xs text-red-300">{k}: {v}</p>)}
          </div>

          <div>
            <label className="label" htmlFor="ov">Override reason <span className="font-normal text-sand">(only if the rate changed a lot vs yesterday)</span></label>
            <input id="ov" className="input" value={form.overrideReason} onChange={set('overrideReason')} disabled={readOnly} maxLength={300} placeholder="e.g. Import duty change" />
          </div>

          {msg && <Alert {...msg} />}

          <div className="divider-gold" />
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : rate ? 'Update rate' : 'Save rate'}</button>}
            <button className="btn-secondary" onClick={doPreview} disabled={previewBusy || busy || (past && !rate)}>
              <span className="text-peach">▣</span>{previewBusy ? 'Rendering…' : 'Preview image'}
            </button>
            {!readOnly && (
              <button className="btn-secondary" onClick={approve} disabled={busy || rate?.status !== 'draft' || dirty}
                title={dirty ? 'Save your changes first' : rate?.status !== 'draft' ? 'Only drafts can be approved' : undefined}>
                <span className="text-emerald-600">✓</span>Approve
              </button>
            )}
            <button className="btn-secondary" onClick={testSend} disabled={testBusy || busy || !savedUsable}
              title={!rate ? 'Save the rate first' : dirty ? 'Save your changes first' : 'Sends the saved rate to you only – never to customers'}>
              <span className="text-peach">⚑</span>{testBusy ? 'Sending…' : 'Test Send'}
            </button>
            {!readOnly && rate && rate.status !== 'cancelled' && <button className="btn-danger ml-auto" onClick={cancel} disabled={busy}>Cancel rate</button>}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="card">
            <h2 className="card-title mb-2">Caption preview</h2>
            <pre className="whitespace-pre-wrap rounded-xl surface p-3 font-sans text-sm leading-relaxed">{liveCaption ?? 'Enter 24K, 22K and 18K to see the caption.'}</pre>
            <p className="hint mt-2">Template can be changed in Settings.</p>
          </section>
          {rate && rate.validation.warnings.length > 0 && <Alert kind="warning" title="Warnings" items={rate.validation.warnings} />}
          <section className="card text-sm text-cream-200/70">
            <h2 className="card-title mb-2">How it works</h2>
            <ol className="space-y-2">
              {[['Save', 'the rate – it becomes a draft.'], ['Preview image', 'to see the exact post.'], ['Approve', 'after checking every value.'], ['Test Send', 'goes to you only. Customers get it at the scheduled time.']].map(([b, t], i) => (
                <li key={b} className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-copper/15 text-[11px] font-bold text-copper">{i + 1}</span><span><b className="text-cream">{b}</b> {t}</span></li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {preview && (
        <section id="preview-panel" className="glass-dark scroll-mt-32 space-y-5 p-5 sm:p-6 rise">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-peach">Image preview</h2>
              {preview.saved
                ? <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-200">saved rate</span>
                : <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-200">unsaved values</span>}
            </div>
            <div className="flex gap-2">
              <a className="btn-ghost-dark btn-sm" href={preview.feedUrl} target="_blank" rel="noreferrer">Open feed</a>
              <a className="btn-ghost-dark btn-sm" href={preview.storyUrl} target="_blank" rel="noreferrer">Open story</a>
              <button className="btn-primary btn-sm" onClick={copyCaption}>{copied ? 'Copied ✓' : 'Copy caption'}</button>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-[1fr_auto_1fr] md:items-start">
            <figure>
              <img src={preview.feedUrl} alt="Instagram feed post 1080×1080" className="w-full rounded-xl border border-white/10 shadow-2xl" />
              <figcaption className="mt-2 text-center text-xs text-sand/80">Feed · 1080 × 1080</figcaption>
            </figure>
            <figure className="mx-auto w-full max-w-[260px]">
              <img src={preview.storyUrl} alt="Instagram story 1080×1920" className="w-full rounded-xl border border-white/10 shadow-2xl" />
              <figcaption className="mt-2 text-center text-xs text-sand/80">Story · 1080 × 1920</figcaption>
            </figure>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sand/80">Caption · WhatsApp + Instagram</p>
              <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-cream/[0.04] p-4 font-sans text-sm leading-relaxed text-cream">{preview.caption}</pre>
              {testResult && (
                <div className="mt-3 rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 text-sm text-violet-100">
                  <p className="font-semibold">Test send recorded {testResult.dryRun && '(DRY RUN – logged, not transmitted)'}</p>
                  <p className="text-xs text-violet-200/90">Admin only · {testResult.delivery.recipient} · {new Date(testResult.delivery.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
                  <p className="mt-1 text-xs text-violet-200/70">No customers were contacted. Real sends happen only via the scheduler / Send Now (Phases 3–4).</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function RatesPage() {
  return <Suspense fallback={<div className="grid gap-6 lg:grid-cols-[1fr_340px]"><CardSkeleton lines={8} /><CardSkeleton lines={4} /></div>}><RateForm /></Suspense>;
}
