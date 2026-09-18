'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { addDays, istDate, istTime, nextSendDescription } from '@chheda/shared';
import { api, ApiError, fmtDate } from '@/lib/api';
import { RateCard, type Rate } from '@/components/RateCard';
import { DeliveryList, type Delivery } from '@/components/DeliveryList';
import { Alert } from '@/components/Alert';
import { StatusBadge } from '@/components/StatusBadge';

type Summary = { today: string; tomorrow: string; todayRate: Rate | null; tomorrowRate: Rate | null };
type Settings = { automationOn: boolean; sendTime: string; cutoffTime: string; channels: Record<string, boolean> };
type DayStatus = { status: string; reason?: string; attempts: number; lastCheckAt?: string; sentAt?: string } | null;
type Integration = { channel: 'instagram' | 'whatsapp'; status: 'not_configured' | 'connected' | 'error'; displayName?: string; expiresAt?: string; lastError?: string };
type WaCounts = { recipients: number; sent: number; failed: number; queued: number; delivered: number; read: number };
type KeywordLog = { date: string; todayCount: number; items: { id: string; channel: string; status: string; recipientMasked?: string; kind: string; error?: string; dryRun: boolean; createdAt: string }[] };
type AlertItem = { id: string; type: string; severity: string; message: string; date?: string; status: string; createdAt: string };

function Stat({ label, value, sub, tone = 'default' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'good' | 'bad' }) {
  const v = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-cream';
  return (
    <section className="card">
      <h2 className="card-title">{label}</h2>
      <p className={`mt-2 text-2xl font-bold ${v}`}>{value}</p>
      {sub && <div className="mt-1 text-sm text-cream-200/70">{sub}</div>}
    </section>
  );
}

export default function Dashboard() {
  const [s, setS] = useState<Summary | null>(null);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [day, setDay] = useState<DayStatus>(null);
  const [wa, setWa] = useState<WaCounts | null>(null);
  const [kw, setKw] = useState<KeywordLog | null>(null);
  const [integrations, setIntegrations] = useState<{ items: Integration[]; dryRun: boolean } | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; title: string } | null>(null);
  const [sending, setSending] = useState(false);

  const load = () => Promise.all([api<Summary>('/rates/summary'), api<{ settings: Settings }>('/settings'), api<{ items: Delivery[]; day: DayStatus; whatsapp: WaCounts }>('/deliveries'), api<{ items: AlertItem[] }>('/alerts?status=open'), api<{ user: { role: string } }>('/auth/me'), api<{ items: Integration[]; dryRun: boolean }>('/integrations'), api<KeywordLog>('/deliveries/keyword')])
    .then(([a, b, c, d, e, f, g]) => { setS(a); setCfg(b.settings); setDeliveries(c.items); setDay(c.day); setWa(c.whatsapp); setAlerts(d.items); setMe(e.user); setIntegrations(f); setKw(g); })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function ack(id: string) {
    try { await api(`/alerts/${id}/ack`, { method: 'POST' }); setAlerts((a) => a.filter((x) => x.id !== id)); } catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); }
  }
  async function sendNow() {
    if (!s?.todayRate) return;
    if (!window.confirm(`Send today's rate (${fmtDate(s.today)}) to all enabled channels NOW?\n\nOnly an approved rate for today can be sent. Channels that already succeeded are skipped.`)) return;
    setSending(true); setMsg(null);
    try {
      const r = await api<{ dryRun: boolean; result: { action: string; channels?: Record<string, string> } }>('/send/now', { method: 'POST' });
      const ch = r.result.channels ? Object.entries(r.result.channels).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
      setMsg({ kind: r.result.action === 'sent' ? 'success' : 'warning', title: `${r.result.action === 'sent' ? 'Sent' : 'Partial'}${r.dryRun ? ' (DRY RUN – logged only)' : ''}. ${ch}` });
      await load();
    } catch (e) {
      setMsg({ kind: 'error', title: e instanceof ApiError && e.status === 409 ? "Nothing sent: today's rate is not approved." : (e as Error).message });
    } finally { setSending(false); }
  }

  if (err) return <p className="text-red-300">{err}</p>;
  if (!s || !cfg) return <p className="text-sand">Loading…</p>;

  const todayOk = !!s.todayRate && ['approved', 'sent'].includes(s.todayRate.status);
  const next = nextSendDescription(istDate(), istTime(), cfg.sendTime, addDays);
  const canSendNow = me?.role === 'admin' && s.todayRate?.status === 'approved';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-cream-200/70">Daily gold rate · Instagram + WhatsApp</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSendNow && <button className="btn-secondary" onClick={sendNow} disabled={sending}>{sending ? 'Sending…' : 'Send now'}</button>}
          <Link className="btn-primary" href={`/rates?date=${s.todayRate?.status === 'sent' ? s.tomorrow : s.today}`}>+ Enter rate</Link>
        </div>
      </div>
      {msg && <Alert {...msg} />}

      {alerts.length > 0 && (
        <section className="card border-red-300/30">
          <div className="mb-2 flex items-center justify-between"><h2 className="card-title text-red-200">Alerts</h2><span className="chip">{alerts.length} open</span></div>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2.5 text-sm sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-semibold text-red-100">{a.type.replace('_', ' ')}{a.date && ` · ${fmtDate(a.date)}`}</p>
                  <p className="text-red-100/85">{a.message}</p>
                  <p className="hint">{new Date(a.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</p>
                </div>
                {me && me.role !== 'viewer' && <button className="btn-secondary btn-sm self-start" onClick={() => ack(a.id)}>Acknowledge</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div role={todayOk ? 'status' : 'alert'} className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-md sm:flex-row sm:items-center ${todayOk ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100' : 'border-red-300/30 bg-red-500/10 text-red-100'}`}>
        <span className={`hidden h-8 w-8 shrink-0 place-items-center rounded-full text-base sm:grid ${todayOk ? 'bg-emerald-400/20' : 'bg-red-400/20'}`}>{todayOk ? '✓' : '!'}</span>
        <p className="flex-1">
          {todayOk ? <><b>Today&apos;s rate is {s.todayRate!.status}.</b> It goes out at {cfg.sendTime} IST{cfg.automationOn ? '' : ' once automation is switched on'}.</>
            : <><b>Today&apos;s rate is not approved.</b> The system will never send an old rate – enter and approve today&apos;s rate before {cfg.cutoffTime} IST.</>}
        </p>
        {!todayOk && <Link className="btn-secondary btn-sm self-start sm:self-auto" href={`/rates?date=${s.today}`}>Fix now</Link>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RateCard title="Today's rate" date={s.today} rate={s.todayRate}
          action={s.todayRate?.status !== 'sent' && <Link className={s.todayRate ? 'btn-secondary' : 'btn-primary'} href={`/rates?date=${s.today}`}>{s.todayRate ? 'Edit / approve' : "Enter today's rate"}</Link>} />
        <RateCard title="Tomorrow's rate" date={s.tomorrow} rate={s.tomorrowRate}
          action={<Link className="btn-secondary" href={`/rates?date=${s.tomorrow}`}>{s.tomorrowRate ? 'Edit / approve' : "Enter tomorrow's rate"}</Link>} />
      </div>

      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="card-title">Today&apos;s delivery</h2>
            <p className="hint">Scheduled sends, Send Now and test sends appear here. Meta publishers stay in DRY RUN until Phase 4.</p>
          </div>
          <div className="flex items-center gap-2">
            {day && <StatusBadge status={day.status === 'sent' ? 'sent' : day.status === 'rate_missing' ? 'missing' : day.status === 'partial' ? 'failed' : day.status === 'skipped' ? 'skipped' : 'queued'} short />}
            {s.todayRate && <Link className="btn-secondary btn-sm" href={`/rates?date=${s.today}`}>Preview / Test Send</Link>}
          </div>
        </div>
        {day?.reason && <p className="mb-2 text-xs text-amber-100/90">Scheduler: {day.reason}{day.lastCheckAt && ` (last check ${new Date(day.lastCheckAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST)`}</p>}
        {deliveries ? <DeliveryList items={deliveries} /> : <p className="text-sm text-sand">Loading…</p>}
      </section>

      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="card-title">Keyword replies</h2>
            <p className="hint">Customers who message a trigger word (e.g. "rate") get today's approved rate back – {cfg.channels.rateKeywordReply ? 'ON' : 'OFF'} · <Link href="/settings" className="text-copper underline">settings</Link></p>
          </div>
          <span className="chip"><b className="text-cream">{kw?.todayCount ?? 0}</b> today</span>
        </div>
        {!kw || kw.items.length === 0 ? <p className="text-sm text-sand">No keyword replies yet.</p> : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-sand"><tr><th className="py-1 pr-3">When</th><th className="pr-3">Channel</th><th className="pr-3">Sender</th><th className="pr-3">Reply</th><th>Status</th></tr></thead>
              <tbody>
                {kw.items.map((i) => (
                  <tr key={i.id} className="border-t border-cream-200/10">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-xs">{new Date(i.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="pr-3 text-xs">{i.channel === 'wa_keyword' ? 'WhatsApp' : 'Instagram'}</td>
                    <td className="pr-3 font-mono text-xs">{i.recipientMasked}</td>
                    <td className="pr-3 text-xs">{i.kind === 'rate' ? "today's rate" : 'check back'}{i.dryRun && ' · dry run'}</td>
                    <td><StatusBadge status={i.status === 'success' ? 'success' : i.status === 'failed' ? 'failed' : 'skipped'} short />{i.error && <span className="ml-1 text-xs text-red-200">{i.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Automation" value={cfg.automationOn ? 'ON' : 'OFF'} tone={cfg.automationOn ? 'good' : 'bad'}
          sub={<>Next send <b>{fmtDate(next.date)} {next.time}</b> IST · cut-off <b>{cfg.cutoffTime}</b> · <Link href="/settings" className="text-copper underline">change</Link></>} />
        {(['instagram', 'whatsapp'] as const).map((ch) => {
          const it = integrations?.items.find((i) => i.channel === ch);
          const ok = it?.status === 'connected';
          const label = ch === 'instagram' ? 'Instagram' : 'WhatsApp';
          const toggles = ch === 'instagram' ? `Feed ${cfg.channels.igFeed ? 'on' : 'off'} · Story ${cfg.channels.igStory ? 'on' : 'off'}` : `Customers ${cfg.channels.waCustomers ? 'on' : 'off'} · Staff share ${cfg.channels.staffShare ? 'on' : 'off'}`;
          return (
            <Stat key={ch} label={label} tone={ok ? 'good' : it?.status === 'error' ? 'bad' : 'default'}
              value={ok ? <span className="text-lg">{it?.displayName ?? 'Connected'}</span> : it?.status === 'error' ? 'Error' : <span className="text-sand">Not connected</span>}
              sub={<>
                {toggles}{integrations?.dryRun && ' · DRY RUN'}
                {it?.lastError && <span className="block text-xs text-red-200">{it.lastError}</span>}
                {ch === 'whatsapp' && wa && wa.recipients > 0 && <span className="block text-xs">Today: {wa.sent} sent · {wa.failed} failed · {wa.delivered} delivered · {wa.read} read</span>}
                <Link href={ch === 'whatsapp' ? '/subscribers' : '/settings/connections'} className="mt-1 block text-xs text-copper underline">{ch === 'whatsapp' ? 'Subscribers' : 'Connections'}</Link>
              </>} />
          );
        })}
      </div>
    </div>
  );
}
