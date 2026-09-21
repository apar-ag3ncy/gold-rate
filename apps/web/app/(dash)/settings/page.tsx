'use client';
import { useEffect, useMemo, useState } from 'react';
import { buildCaption, validateCaptionTemplate, CAPTION_PLACEHOLDERS, istDate } from '@chheda/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { CardSkeleton } from '@/components/ui';
import type { Rate } from '@/components/RateCard';

type Settings = {
  automationOn: boolean; sendTime: string; cutoffTime: string;
  priceMin: number; priceMax: number; maxDailyChangePct: number;
  channels: { igFeed: boolean; igStory: boolean; waCustomers: boolean; staffShare: boolean; rateKeywordReply: boolean };
  captionTemplate: string; defaultCaptionTemplate: string;
  whatsapp: { templateName: string; templateLanguage: string; includeExtrasParam: boolean };
  manualReminderMinutes: number;
  ibja: { enabled: boolean; autoDraft: boolean; autoApprove: boolean; draftFor: 'today' | 'tomorrow'; preferSession: 'AM' | 'PM'; fetchTimes: string[]; maxAgeDays: number };
  keywordReply: { triggers: string[]; maxPerSenderPerDay: number; notReadyMessage: string; defaults: { triggers: string[]; maxPerSenderPerDay: number; notReadyMessage: string } };
  adminAlerts: { emails: string[]; whatsappNumbers: string[]; templateName?: string; templateLanguage?: string };
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

  if (!s) return <div className="grid gap-5 lg:grid-cols-2"><CardSkeleton lines={4} /><CardSkeleton lines={5} /></div>;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const { automationOn, sendTime, cutoffTime, priceMin, priceMax, maxDailyChangePct, channels, captionTemplate, whatsapp, manualReminderMinutes, adminAlerts, keywordReply, ibja } = s!;
      const r = await api<{ settings: Settings }>('/settings', { method: 'PUT', body: { automationOn, sendTime, cutoffTime, priceMin, priceMax, maxDailyChangePct, channels, captionTemplate, whatsapp, manualReminderMinutes, adminAlerts: { ...adminAlerts, emails: adminAlerts.emails.filter(Boolean), whatsappNumbers: adminAlerts.whatsappNumbers.filter(Boolean) }, keywordReply: { triggers: keywordReply.triggers.filter(Boolean), maxPerSenderPerDay: keywordReply.maxPerSenderPerDay, notReadyMessage: keywordReply.notReadyMessage }, ibja: { ...ibja, fetchTimes: ibja.fetchTimes.filter(Boolean) } } });
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

      <Section title="IBJA benchmark rate" sub="Daily gold benchmark from IBJA (999 → 24K, 916 → 22K, 750 → 18K, per-10 g ÷ 10 exactly). It can pre-fill or draft the rate; approval still decides what is sent."
        right={<div className="flex items-center gap-2 text-sm font-semibold"><span className={s.ibja.enabled ? 'text-emerald-300' : 'text-sand'}>{s.ibja.enabled ? 'ON' : 'OFF'}</span><Toggle label="IBJA reference" on={s.ibja.enabled} onChange={() => setS({ ...s, ibja: { ...s.ibja, enabled: !s.ibja.enabled } })} /></div>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-copper" checked={s.ibja.autoDraft} onChange={(e) => setS({ ...s, ibja: { ...s.ibja, autoDraft: e.target.checked, autoApprove: e.target.checked ? s.ibja.autoApprove : false } })} /><span><b>Auto-draft</b> after each fetch<span className="block text-xs text-cream-200/70">Creates or refreshes the draft for {s.ibja.draftFor} from the IBJA rate. Never touches a rate a person entered.</span></span></label>
          <label className={`flex items-start gap-3 text-sm ${s.ibja.autoDraft ? '' : 'opacity-50'}`}><input type="checkbox" className="mt-1 h-4 w-4 accent-copper" disabled={!s.ibja.autoDraft} checked={s.ibja.autoApprove} onChange={(e) => setS({ ...s, ibja: { ...s.ibja, autoApprove: e.target.checked } })} /><span><b className="text-amber-200">Auto-approve</b> the IBJA draft<span className="block text-xs text-amber-100/80">Fully hands-off: the benchmark rate is sent at the send time without anyone checking it. Keep OFF during the trial.</span></span></label>
          <div><label className="label" htmlFor="ibja-for">Draft for</label><select id="ibja-for" className="input" value={s.ibja.draftFor} onChange={(e) => setS({ ...s, ibja: { ...s.ibja, draftFor: e.target.value as any } })}><option value="tomorrow">Tomorrow (evening PM rate → next morning&apos;s post)</option><option value="today">Today</option></select></div>
          <div><label className="label" htmlFor="ibja-sess">Prefer session</label><select id="ibja-sess" className="input" value={s.ibja.preferSession} onChange={(e) => setS({ ...s, ibja: { ...s.ibja, preferSession: e.target.value as any } })}><option value="PM">PM (closing, ~18:10 IST)</option><option value="AM">AM (opening, ~12:10 IST)</option></select></div>
          <div><label className="label" htmlFor="ibja-age">Ignore snapshots older than (days)</label><input id="ibja-age" type="number" min={1} max={14} className="input kbd-money" value={s.ibja.maxAgeDays} onChange={(e) => setS({ ...s, ibja: { ...s.ibja, maxAgeDays: Number(e.target.value) } })} /><p className="hint">Covers weekends and holidays; an older benchmark is never drafted.</p></div>
          <div><label className="label" htmlFor="ibja-times">Fetch times (IST, comma-separated, after IBJA publishes at ~12:10 and ~18:10)</label><input id="ibja-times" className="input font-mono" value={s.ibja.fetchTimes.join(', ')} onChange={(e) => setS({ ...s, ibja: { ...s.ibja, fetchTimes: e.target.value.split(',').map((x) => x.trim()) } })} placeholder="12:40, 18:40" /></div>
        </div>
        <p className="hint">Source: set with IBJA_SOURCE in .env – the public ibjarates.com page for the trial, the official IBJA API (subscription) for live pricing.</p>
      </Section>

      <Section title='"RATE" keyword auto-reply' sub="Customers who message a trigger word on WhatsApp or Instagram get today's approved rate back automatically."
        right={<div className="flex items-center gap-2 text-sm font-semibold"><span className={s.channels.rateKeywordReply ? 'text-emerald-300' : 'text-sand'}>{s.channels.rateKeywordReply ? 'ON' : 'OFF'}</span><Toggle label="Keyword auto-reply" on={s.channels.rateKeywordReply} onChange={() => setS({ ...s, channels: { ...s.channels, rateKeywordReply: !s.channels.rateKeywordReply } })} /></div>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kwt">Trigger words (one per line, whole message must match)</label>
            <textarea id="kwt" rows={6} className="input font-mono text-xs" value={s.keywordReply.triggers.join('\n')} onChange={(e) => setS({ ...s, keywordReply: { ...s.keywordReply, triggers: e.target.value.split(/\n/).map((x) => x.trim()) } })} />
            <div className="mt-1 flex items-center justify-between"><p className="hint">Case, spaces and punctuation are ignored. JOIN/STOP are reserved.</p><button type="button" className="text-xs text-copper underline" onClick={() => setS({ ...s, keywordReply: { ...s.keywordReply, triggers: [...s.keywordReply.defaults.triggers] } })}>Reset</button></div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="kwl">Max auto-replies per sender per day</label>
              <input id="kwl" type="number" min={1} max={50} className="input kbd-money" value={s.keywordReply.maxPerSenderPerDay} onChange={(e) => setS({ ...s, keywordReply: { ...s.keywordReply, maxPerSenderPerDay: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="label" htmlFor="kwn">Reply when today's rate is not approved yet</label>
              <textarea id="kwn" rows={3} className="input text-sm" value={s.keywordReply.notReadyMessage} onChange={(e) => setS({ ...s, keywordReply: { ...s.keywordReply, notReadyMessage: e.target.value } })} />
              <p className="hint">Must not contain a rate or number – an old rate is never sent.</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Staff share & admin alerts" sub="Who gets alerted, and how long staff have before a reminder.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rem">Reminder if not marked posted after (minutes)</label>
            <input id="rem" type="number" min={5} max={240} className="input kbd-money" value={s.manualReminderMinutes} onChange={(e) => setS({ ...s, manualReminderMinutes: Number(e.target.value) })} />
            <p className="hint">Staff get a push reminder and an admin alert is raised for each channel still pending.</p>
          </div>
          <div>
            <label className="label" htmlFor="tplalert">Admin alert WhatsApp template (utility)</label>
            <div className="flex gap-2">
              <input id="tplalert" className="input font-mono" value={s.adminAlerts.templateName ?? ''} onChange={(e) => setS({ ...s, adminAlerts: { ...s.adminAlerts, templateName: e.target.value } })} placeholder="admin_alert" />
              <input className="input w-24 font-mono" value={s.adminAlerts.templateLanguage ?? ''} onChange={(e) => setS({ ...s, adminAlerts: { ...s.adminAlerts, templateLanguage: e.target.value } })} placeholder="en" />
            </div>
            <p className="hint">Body {'{{1}}'} = title, {'{{2}}'} = message. Sent only when DRY_RUN=false and WhatsApp is connected.</p>
          </div>
          <div>
            <label className="label" htmlFor="emails">Alert emails (one per line)</label>
            <textarea id="emails" rows={3} className="input font-mono text-xs" value={s.adminAlerts.emails.join('\n')} onChange={(e) => setS({ ...s, adminAlerts: { ...s.adminAlerts, emails: e.target.value.split(/\n/).map((x) => x.trim()) } })} placeholder="owner@chhedajewellers.com" />
            <p className="hint">Needs SMTP_* in .env. Empty = no emails.</p>
          </div>
          <div>
            <label className="label" htmlFor="nums">Admin WhatsApp numbers (one per line)</label>
            <textarea id="nums" rows={3} className="input font-mono text-xs" value={s.adminAlerts.whatsappNumbers.join('\n')} onChange={(e) => setS({ ...s, adminAlerts: { ...s.adminAlerts, whatsappNumbers: e.target.value.split(/\n/).map((x) => x.trim()) } })} placeholder="+919876543210" />
            <p className="hint">Stored encrypted; shown masked after saving. Keep the masked lines to keep the numbers.</p>
          </div>
        </div>
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
