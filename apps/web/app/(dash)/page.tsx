'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, istDate, istTime, nextSendDescription, MANUAL_CHANNEL_INFO } from '@chheda/shared';
import { api, ApiError, channelLabel, fmtDate, fmtDateTime, fmtTime, perGram, triggerLabel } from '@/lib/api';
import { RateCard, type Rate } from '@/components/RateCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/Alert';
import { CardSkeleton, EmptyState, ErrorState, Modal } from '@/components/ui';
import { useSession } from '@/components/Shell';
import type { Delivery } from '@/components/DeliveryList';

type Summary = { today: string; tomorrow: string; todayRate: Rate | null; tomorrowRate: Rate | null };
type Settings = { automationOn: boolean; sendTime: string; cutoffTime: string; channels: Record<string, boolean> };
type DayStatus = { status: string; reason?: string; attempts: number; lastCheckAt?: string; sentAt?: string } | null;
type Integration = { channel: 'instagram' | 'whatsapp'; status: string; displayName?: string; expiresAt?: string; lastError?: string };
type WaCounts = { recipients: number; sent: number; failed: number; queued: number; delivered: number; read: number };
type Plan = { date: string; dryRun: boolean; canSend: boolean; reason?: string; subscribers: number; rate: { k24: number; k22: number; k18: number; extraPurities: { label: string; value: number }[] } | null; channels: { channel: string; enabled: boolean; alreadySent: boolean; recipients?: number; manual?: boolean }[] };
type IbjaLatest = { latest: { rateDate: string; session: string; perGram: { k24: string; k22: string; k18: string }; fetchedAt: string } | null; settings: { enabled: boolean; autoDraft: boolean; autoApprove: boolean }; lastFetch: { ok: boolean; error?: string; at: string } | null };
type Data = { s: Summary; cfg: Settings; deliveries: Delivery[]; day: DayStatus; wa: WaCounts; integrations: Integration[]; dryRun: boolean; subscribers: number | null; ibja: IbjaLatest | null };

const dayLabel: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  sent: { text: 'Sent', tone: 'ok' }, partial: { text: 'Partly sent', tone: 'bad' }, rate_missing: { text: 'Rate missing', tone: 'bad' }, skipped: { text: 'Skipped', tone: 'bad' }, pending: { text: 'Waiting for send time', tone: 'neutral' },
};

function useCountdown(date: string, time: string) {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const target = new Date(`${date}T${time}:00+05:30`).getTime();
    const tick = () => { const ms = target - Date.now(); if (ms <= 0) return setLeft('now'); const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000); setLeft(h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`); };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [date, time]);
  return left;
}

export default function Dashboard() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; title: string; items?: string[] } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const session = useSession();
  const role = session.me?.role;
  const load = useCallback(async () => {
    if (!role) return; // wait for the shared /auth/me
    try {
      const [s, cfg, del, integ] = await Promise.all([
        api<Summary>('/rates/summary'), api<{ settings: Settings }>('/settings'), api<{ items: Delivery[]; day: DayStatus; whatsapp: WaCounts }>('/deliveries'),
        api<{ items: Integration[]; dryRun: boolean }>('/integrations'),
      ]);
      const ibja = await api<IbjaLatest>('/ibja/latest').catch(() => null);
      const subs = role === 'viewer' ? null : await api<{ counts: { active: number } }>('/subscribers?limit=1').then((r) => r.counts.active).catch(() => null);
      setD({ s, cfg: cfg.settings, deliveries: del.items, day: del.day, wa: del.whatsapp, integrations: integ.items, dryRun: integ.dryRun, subscribers: subs, ibja });
      session.refreshAlerts();
      setErr(''); setRefreshedAt(new Date());
    } catch (e) { setErr((e as Error).message); }
  }, [role]);

  // auto-refresh every 30 s, paused while the tab is hidden
  useEffect(() => {
    load();
    const start = () => { if (!timer.current) timer.current = setInterval(load, 30_000); };
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
    const vis = () => { if (document.hidden) stop(); else { load(); start(); } };
    start(); document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  async function toggleAutomation() {
    if (!d) return;
    setToggling(true);
    try { const r = await api<{ settings: Settings }>('/settings', { method: 'PUT', body: { automationOn: !d.cfg.automationOn } }); setD({ ...d, cfg: r.settings }); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); } finally { setToggling(false); }
  }
  async function openPlan() {
    setMsg(null);
    try { setPlan(await api<Plan>('/send/plan')); setPlanOpen(true); } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
  }
  async function sendNow() {
    setSending(true);
    try {
      const r = await api<{ dryRun: boolean; result: { action: string; channels?: Record<string, string>; reason?: string } }>('/send/now', { method: 'POST' });
      const ch = r.result.channels ? Object.entries(r.result.channels).map(([k, v]) => `${channelLabel[k] ?? k}: ${v.replace('_', ' ')}`) : [];
      setMsg({ kind: r.result.action === 'sent' ? 'success' : 'warning', title: `${r.result.action === 'sent' ? 'Sent on every automatic channel' : r.result.action === 'partial' ? 'Sent on some channels only – see below' : r.result.action}${r.dryRun ? ' (DRY RUN – logged only)' : ''}.`, items: ch });
      setPlanOpen(false); await load();
    } catch (e) { setMsg({ kind: 'error', title: e instanceof ApiError && e.status === 409 ? "Nothing sent: today's rate is not approved." : (e as Error).message }); }
    finally { setSending(false); }
  }

  const next = d ? nextSendDescription(istDate(), istTime(), d.cfg.sendTime, addDays) : null;
  const countdown = useCountdown(next?.date ?? istDate(), next?.time ?? '07:00');

  if (err && !d) return <ErrorState message={err} retry={load} />;
  if (!d) return <div className="grid gap-4 md:grid-cols-2"><CardSkeleton lines={4} /><CardSkeleton lines={4} /><CardSkeleton /><CardSkeleton /></div>;

  const { s, cfg, day } = d;
  const rateStatus = s.todayRate?.status ?? 'missing';
  const banner = (() => {
    if (day?.status === 'sent' || rateStatus === 'sent') return { tone: 'ok', title: "Today is handled – the rate went out.", text: `Sent ${day?.sentAt ? fmtTime(day.sentAt) : ''}${d.dryRun ? ' (DRY RUN)' : ''}.` };
    if (day?.status === 'partial') return { tone: 'bad', title: 'Sent on some channels only.', text: day.reason ?? 'Retry the failed channels below.' };
    if (day?.status === 'skipped') return { tone: 'bad', title: 'Today was skipped.', text: day.reason ?? 'The cut-off passed without an approved rate.' };
    if (rateStatus === 'approved') return { tone: 'ok', title: `Today's rate is approved – sends at ${cfg.sendTime} IST${cfg.automationOn ? '' : ' once automation is ON'}.`, text: day?.status === 'rate_missing' ? 'The scheduler will pick it up on its next 15-minute check.' : `Next send in ${countdown}.` };
    if (rateStatus === 'draft') return { tone: 'warn', title: "Today's rate is saved but NOT approved.", text: `Approve it before ${cfg.cutoffTime} IST – the system will never send an old rate.` };
    if (rateStatus === 'cancelled') return { tone: 'bad', title: "Today's rate was cancelled.", text: 'Save and approve a new rate if something should go out today.' };
    return { tone: 'bad', title: "Today's rate has not been entered.", text: `Enter and approve it before ${cfg.cutoffTime} IST – nothing is sent until then.` };
  })();
  const toneCls = { ok: 'border-emerald-300/30 bg-emerald-400/10', warn: 'border-amber-300/30 bg-amber-400/10', bad: 'border-red-300/30 bg-red-500/10', neutral: 'border-cream-200/15 bg-cream/[0.04]' }[banner.tone as 'ok'];
  const ig = d.integrations.find((i) => i.channel === 'instagram'), wa = d.integrations.find((i) => i.channel === 'whatsapp');
  const expiryDays = (i?: Integration) => i?.expiresAt ? Math.floor((new Date(i.expiresAt).getTime() - Date.now()) / 86_400_000) : null;
  const autoRows = d.deliveries.filter((x) => !x.channel.endsWith('_manual') && x.trigger !== 'keyword');
  const manualRows = d.deliveries.filter((x) => x.channel.endsWith('_manual'));
  const failed = autoRows.filter((x) => x.status === 'failed');
  const isAdmin = role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="page-title">Dashboard</h1><p className="text-sm text-cream-200/70">{fmtDate(s.today)} · refreshed {refreshedAt ? fmtTime(refreshedAt) : '…'} · updates every 30 s</p></div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && rateStatus === 'approved' && <button className="btn-secondary" onClick={openPlan}>Send now</button>}
          <Link className="btn-primary" href={`/rates?date=${rateStatus === 'sent' ? s.tomorrow : s.today}`}>+ Enter rate</Link>
        </div>
      </div>
      {msg && <Alert {...msg} />}
      {err && <ErrorState message={`Refresh failed: ${err}`} retry={load} />}

      <section role={banner.tone === 'ok' ? 'status' : 'alert'} className={`rounded-2xl border p-4 backdrop-blur-md sm:p-5 ${toneCls}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="eyebrow">Is today handled?</p>
            <h2 className="mt-1 font-serif text-2xl font-light sm:text-3xl">{banner.title}</h2>
            <p className="mt-1 text-sm text-cream-200/85">{banner.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={rateStatus} />{day && <span className="chip">Day: {dayLabel[day.status]?.text ?? day.status}</span>}</div>
          </div>
          {s.todayRate && (
            <dl className="grid gap-2 text-center sm:grid-cols-3">
              {([['24K', s.todayRate.k24], ['22K', s.todayRate.k22], ['18K', s.todayRate.k18]] as const).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-cream-200/15 bg-emerald-950/40 px-3 py-2 sm:block"><dt className="text-[10px] uppercase tracking-wider text-copper">{k}</dt><dd className="kbd-money whitespace-nowrap text-lg font-bold">{perGram(v)}</dd></div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <section className="card"><h2 className="card-title">Next send</h2><p className="mt-2 font-serif text-3xl font-light">{countdown}</p><p className="hint">{next && `${fmtDate(next.date)} ${next.time} IST`} · cut-off {cfg.cutoffTime}</p></section>
        <section className="card">
          <div className="flex items-start justify-between"><h2 className="card-title">Automation</h2>
            {isAdmin && <button type="button" role="switch" aria-checked={cfg.automationOn} aria-label="Automation" disabled={toggling} onClick={toggleAutomation} className={`relative h-6 w-11 shrink-0 rounded-full border transition ${cfg.automationOn ? 'border-copper bg-copper' : 'border-cream-200/20 bg-cream/15'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${cfg.automationOn ? 'left-5' : 'left-0.5'}`} /></button>}
          </div>
          <p className={`mt-2 text-2xl font-bold ${cfg.automationOn ? 'text-emerald-300' : 'text-red-300'}`}>{cfg.automationOn ? 'ON' : 'OFF'}</p>
          <p className="hint">{cfg.automationOn ? `Sends daily at ${cfg.sendTime} IST` : 'Nothing is sent automatically'}{d.dryRun && ' · DRY RUN'}</p>
        </section>
        {[{ i: ig, label: 'Instagram', href: '/settings/connections' }, { i: wa, label: 'WhatsApp', href: '/settings/connections' }].map(({ i, label, href }) => {
          const days = expiryDays(i); const ok = i?.status === 'connected';
          return (
            <section key={label} className="card">
              <h2 className="card-title">{label}</h2>
              <p className={`mt-2 text-lg font-semibold ${ok ? 'text-emerald-300' : i?.status === 'error' ? 'text-red-300' : 'text-sand'}`}>{ok ? (i?.displayName ?? 'Connected') : i?.status === 'error' ? 'Error' : 'Not connected'}</p>
              <p className="hint">
                {days !== null && <span className={days <= 7 ? 'text-amber-200' : ''}>Token: {days <= 0 ? 'expired' : `${days} days left`}</span>}
                {days === null && ok && 'Token: no expiry'}
                {label === 'WhatsApp' && d.subscribers !== null && <>{(days !== null || ok) ? ' · ' : ''}{d.subscribers} subscribers</>}
                {i?.lastError && <span className="block text-red-200">{i.lastError}</span>}
              </p>
              <Link href={href} className="mt-1 inline-block text-xs text-copper underline">Connections</Link>
            </section>
          );
        })}
        <section className={`card ${session.openAlerts ? 'border-red-300/30' : ''}`}><h2 className="card-title">Alerts</h2><p className={`mt-2 text-2xl font-bold ${session.openAlerts ? 'text-red-300' : 'text-emerald-300'}`}>{session.openAlerts}</p><p className="hint">unacknowledged</p><Link href="/alerts" className="mt-1 inline-block text-xs text-copper underline">Open alerts</Link></section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="card">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="card-title">Today&apos;s deliveries</h2>
            <div className="flex gap-2">{isAdmin && failed.length > 0 && rateStatus !== 'sent' && <button className="btn-secondary btn-sm" onClick={openPlan}>Retry {failed.length} failed</button>}<Link href="/deliveries" className="btn-secondary btn-sm">Full log</Link></div></div>
          {autoRows.length === 0 ? <EmptyState title="Nothing sent yet today" hint={rateStatus === 'approved' ? `The scheduler sends at ${cfg.sendTime} IST.` : 'Deliveries appear here once the approved rate goes out.'} /> : (
            <ul className="divide-y divide-cream-200/10">
              {autoRows.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-[10rem] font-medium">{channelLabel[x.channel] ?? x.channel}</span>
                  <span className="text-xs text-cream-200/70">{triggerLabel[x.trigger] ?? x.trigger} · {fmtTime(x.createdAt)}{x.stats && ` · ${x.stats.sent}/${x.stats.total} sent`}{x.dryRun && ' · dry run'}</span>
                  <span className="ml-auto flex items-center gap-2"><StatusBadge status={x.status} short />{x.status === 'failed' && isAdmin && <button className="btn-secondary btn-sm" onClick={openPlan}>Retry</button>}</span>
                  {x.error && <p className="w-full text-xs text-red-200">{x.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {d.wa.recipients > 0 && <p className="hint mt-2">WhatsApp customers today: {d.wa.sent} sent · {d.wa.failed} failed · {d.wa.delivered} delivered · {d.wa.read} read</p>}
        </section>
        <section className="card">
          <div className="mb-3 flex items-center justify-between"><h2 className="card-title">Staff share</h2><Link href="/staff" className="btn-secondary btn-sm">Staff app</Link></div>
          {manualRows.length === 0 ? <EmptyState title="No staff tasks yet" hint="Created automatically when the rate goes out." /> : (
            <ul className="space-y-2 text-sm">
              {manualRows.map((x) => (
                <li key={x.id} className="surface flex items-center gap-3 px-3 py-2">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${x.status === 'success' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-copper/20 text-peach'}`}>{x.status === 'success' ? '✓' : '…'}</span>
                  <div className="min-w-0 flex-1"><p className="font-medium">{MANUAL_CHANNEL_INFO[x.channel as keyof typeof MANUAL_CHANNEL_INFO]?.label ?? x.channel}</p><p className="hint">{x.status === 'success' ? `Posted by ${x.postedBy} · ${fmtTime(x.postedAt)}` : `Pending${x.reminderSentAt ? ' · reminder sent' : ''} · since ${fmtTime(x.createdAt)}`}</p></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {d.ibja?.settings.enabled && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="card-title">IBJA benchmark</h2><p className="hint">{d.ibja.latest ? `${d.ibja.latest.session} rate of ${fmtDate(d.ibja.latest.rateDate)} · fetched ${fmtTime(d.ibja.latest.fetchedAt)}` : 'not fetched yet'}{d.ibja.lastFetch && !d.ibja.lastFetch.ok && <span className="text-red-200"> · last fetch failed: {d.ibja.lastFetch.error}</span>} · auto-draft {d.ibja.settings.autoDraft ? 'ON' : 'OFF'}{d.ibja.settings.autoApprove && ' · auto-approve ON'}</p></div>
            {d.ibja.latest && <dl className="flex gap-2 text-center">{([['24K', d.ibja.latest.perGram.k24], ['22K', d.ibja.latest.perGram.k22], ['18K', d.ibja.latest.perGram.k18]] as const).map(([k, v]) => <div key={k} className="rounded-xl border border-cream-200/15 bg-emerald-950/40 px-3 py-1.5"><dt className="text-[10px] uppercase tracking-wider text-copper">{k}</dt><dd className="kbd-money font-bold">₹{v}/g</dd></div>)}</dl>}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <RateCard title="Today's rate" date={s.today} rate={s.todayRate} action={s.todayRate?.status !== 'sent' && <Link className="btn-secondary btn-sm" href={`/rates?date=${s.today}`}>{s.todayRate ? 'Edit / approve' : "Enter today's rate"}</Link>} />
        <RateCard title="Tomorrow's rate" date={s.tomorrow} rate={s.tomorrowRate} action={<Link className="btn-secondary btn-sm" href={`/rates?date=${s.tomorrow}`}>{s.tomorrowRate ? 'Edit / approve' : "Enter tomorrow's rate"}</Link>} />
      </div>

      <Modal open={planOpen} title="Send now?" onClose={() => setPlanOpen(false)}
        footer={<><button className="btn-secondary" onClick={() => setPlanOpen(false)}>Cancel</button>{plan?.canSend && <button className="btn-primary" onClick={sendNow} disabled={sending}>{sending ? 'Sending…' : plan.dryRun ? 'Send now (dry run)' : 'Send now'}</button>}</>}>
        {!plan ? <p>Loading…</p> : !plan.canSend ? <Alert kind="warning" title={plan.reason ?? 'Cannot send'} /> : (
          <>
            <p>This sends <b>{fmtDate(plan.date)}</b>&apos;s approved rate right now{plan.dryRun && <> — <b>DRY RUN</b>: it will be logged, not posted</>}.</p>
            {plan.rate && <p className="kbd-money">24K {perGram(plan.rate.k24)} · 22K {perGram(plan.rate.k22)} · 18K {perGram(plan.rate.k18)}{plan.rate.extraPurities.map((p) => ` · ${p.label} ${perGram(p.value)}`)}</p>}
            <ul className="space-y-1">
              {plan.channels.map((c) => (
                <li key={c.channel} className="flex items-center justify-between gap-2 rounded-lg bg-cream/[0.04] px-3 py-1.5">
                  <span>{channelLabel[c.channel] ?? c.channel}{c.recipients !== undefined && <span className="text-cream-200/70"> · {c.recipients} opted-in customers</span>}</span>
                  <span className="text-xs">{!c.enabled ? 'off in settings' : c.alreadySent ? 'already sent – skipped' : c.manual ? 'task for staff' : 'will send'}</span>
                </li>
              ))}
            </ul>
            <p className="hint">Channels that already succeeded are never repeated.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
