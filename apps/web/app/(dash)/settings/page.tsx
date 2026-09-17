'use client';
import { useEffect, useMemo, useState } from 'react';
import { buildCaption, validateCaptionTemplate, CAPTION_PLACEHOLDERS, istDate } from '@chheda/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/Alert';
import type { Rate } from '@/components/RateCard';

type Settings = {
  automationOn: boolean; sendTime: string; cutoffTime: string;
  priceMin: number; priceMax: number; maxDailyChangePct: number;
  channels: { igFeed: boolean; igStory: boolean; waCustomers: boolean; staffShare: boolean; rateKeywordReply: boolean };
  captionTemplate: string; defaultCaptionTemplate: string;
  whatsapp: { templateName: string; templateLanguage: string; includeExtrasParam: boolean };
};
const channelLabels: Record<keyof Settings['channels'], [string, string]> = {
  igFeed: ['Instagram Feed post', 'automatic'],
  igStory: ['Instagram Story', 'automatic'],
  waCustomers: ['WhatsApp – opted-in customers', 'automatic'],
  staffShare: ['Staff 1-tap share', 'Instagram Broadcast + WhatsApp Channel/Community'],
  rateKeywordReply: ['"RATE" keyword auto-reply', 'Instagram DM + WhatsApp'],
};
const SAMPLE = { date: istDate(), k24: 11250, k22: 10305.5, k18: 8437, extraPurities: [{ label: '14K', value: 6560 }] };

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition ${on ? 'border-copper bg-copper shadow-[0_0_18px_-4px_rgba(198,141,97,.9)]' : 'border-cream-200/20 bg-cream/15'}`}>
      <span className={`absolute top-0.5 h-5.5 w-5.5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-0.5'}`} style={{ height: 22, width: 22 }} />
    </button>
  );
}

function Section({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="card-title">{title}</h2>{sub && <p className="hint mt-0.5">{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [sample, setSample] = useState<typeof SAMPLE>(SAMPLE);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; title: string; items?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>('/settings').then((r) => setS(r.settings));
    api<{ todayRate: Rate | null }>('/rates/summary').then((r) => {
      if (r.todayRate) setSample({ date: r.todayRate.date, k24: r.todayRate.k24, k22: r.todayRate.k22, k18: r.todayRate.k18, extraPurities: r.todayRate.extraPurities });
    }).catch(() => {});
  }, []);

  const check = useMemo(() => (s ? validateCaptionTemplate(s.captionTemplate) : { ok: true, errors: [] }), [s]);
  const captionPreview = useMemo(() => {
    if (!s || !check.ok) return '';
    try { return buildCaption(s.captionTemplate, sample); } catch { return ''; }
  }, [s, check.ok, sample]);

  if (!s) return <p className="text-sand">Loading…</p>;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const { automationOn, sendTime, cutoffTime, priceMin, priceMax, maxDailyChangePct, channels, captionTemplate, whatsapp } = s!;
      const r = await api<{ settings: Settings }>('/settings', { method: 'PUT', body: { automationOn, sendTime, cutoffTime, priceMin, priceMax, maxDailyChangePct, channels, captionTemplate, whatsapp } });
      setS(r.settings); setMsg({ kind: 'success', title: 'Settings saved.' });
    } catch (e) {
      const d = (e as ApiError).details?.fields;
      setMsg({ kind: 'error', title: (e as Error).message, items: d ? Object.values(d as Record<string, string>) : undefined });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="text-sm text-cream-200/70">Schedule, channels, caption and safety checks.</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={busy || !check.ok}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
      {msg && <Alert {...msg} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Automation" sub="When OFF, nothing is sent automatically."
          right={<div className="flex items-center gap-2 text-sm font-semibold"><span className={s.automationOn ? 'text-emerald-300' : 'text-sand'}>{s.automationOn ? 'ON' : 'OFF'}</span><Toggle label="Automation" on={s.automationOn} onChange={() => setS({ ...s, automationOn: !s.automationOn })} /></div>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="send">Daily send time (IST)</label>
              <input id="send" type="time" className="input" value={s.sendTime} onChange={(e) => setS({ ...s, sendTime: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cut">Late-send cut-off (IST)</label>
              <input id="cut" type="time" className="input" value={s.cutoffTime} onChange={(e) => setS({ ...s, cutoffTime: e.target.value })} />
            </div>
          </div>
          <p className="hint">If the rate is missing at send time, it is sent as soon as it is approved – but never after the cut-off, and never an old rate.</p>
        </Section>

        <Section title="Channels" sub="Turn each destination on or off.">
          <ul className="divide-y divide-cream-200/10 rounded-xl surface">
            {(Object.keys(channelLabels) as (keyof Settings['channels'])[]).map((k) => (
              <li key={k} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span><span className="font-medium">{channelLabels[k][0]}</span><span className="block text-xs text-sand">{channelLabels[k][1]}</span></span>
                <Toggle label={channelLabels[k][0]} on={s.channels[k]} onChange={() => setS({ ...s, channels: { ...s.channels, [k]: !s.channels[k] } })} />
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Caption template" sub="Used for WhatsApp messages and the Instagram caption."
        right={<button type="button" className="btn-secondary btn-sm" onClick={() => setS({ ...s, captionTemplate: s.defaultCaptionTemplate })}>Reset to default</button>}>
        <div className="flex flex-wrap gap-1.5">
          {CAPTION_PLACEHOLDERS.map((p) => (
            <button key={p} type="button" className="chip font-mono hover:bg-copper/15" title="Insert placeholder"
              onClick={() => setS({ ...s, captionTemplate: `${s.captionTemplate}{${p}}` })}>{`{${p}}`}</button>
          ))}
          <span className="hint self-center">← click to append</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="tpl">Template</label>
            <textarea id="tpl" rows={11} className={`input font-mono text-xs leading-relaxed ${check.ok ? '' : 'border-red-400'}`} value={s.captionTemplate}
              onChange={(e) => setS({ ...s, captionTemplate: e.target.value })} aria-invalid={!check.ok} />
            {!check.ok && <ul className="mt-1.5 list-disc pl-5 text-xs text-red-300">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
          <div>
            <p className="label">Live preview <span className="font-normal text-sand">{sample !== SAMPLE ? "(today's rate)" : '(sample values)'}</span></p>
            <pre className="whitespace-pre-wrap rounded-xl surface p-3 font-sans text-sm leading-relaxed">{check.ok ? captionPreview : 'Fix the template to see a preview.'}</pre>
          </div>
        </div>
      </Section>

      <Section title="WhatsApp template" sub="The approved Cloud API template used for customer messages (image header + body {{1}} date, {{2}} 24K, {{3}} 22K, {{4}} 18K[, {{5}} other purities]).">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="tplname">Template name</label><input id="tplname" className="input font-mono" value={s.whatsapp.templateName} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, templateName: e.target.value } })} /></div>
          <div><label className="label" htmlFor="tpllang">Language code</label><input id="tpllang" className="input font-mono" value={s.whatsapp.templateLanguage} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, templateLanguage: e.target.value } })} placeholder="en" /></div>
          <label className="flex items-center gap-3 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-copper" checked={s.whatsapp.includeExtrasParam} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, includeExtrasParam: e.target.checked } })} />Template has a 5th parameter for other purities</label>
        </div>
        <p className="hint">Create and get the template approved in WhatsApp Manager first; the name and parameter count must match exactly. Tokens and ids live on the Connections page.</p>
      </Section>

      <Section title="Safety checks" sub="These only block mistakes – they never change a rate.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="min">Min ₹/g</label><input id="min" type="number" className="input kbd-money" value={s.priceMin} onChange={(e) => setS({ ...s, priceMin: Number(e.target.value) })} /></div>
          <div><label className="label" htmlFor="max">Max ₹/g</label><input id="max" type="number" className="input kbd-money" value={s.priceMax} onChange={(e) => setS({ ...s, priceMax: Number(e.target.value) })} /></div>
          <div><label className="label" htmlFor="chg">Max daily change %</label><input id="chg" type="number" step="0.5" className="input kbd-money" value={s.maxDailyChangePct} onChange={(e) => setS({ ...s, maxDailyChangePct: Number(e.target.value) })} /></div>
        </div>
        <p className="hint">Rates outside the range are rejected (catches a missing or extra digit). A bigger day-to-day change needs a written override reason.</p>
      </Section>

      <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={busy || !check.ok}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </div>
  );
}
