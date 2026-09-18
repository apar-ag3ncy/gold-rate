'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MANUAL_CHANNEL_INFO, type StaffToday } from '@chheda/shared';
import { api, ApiError, fmtDate } from '@/lib/api';
import { Alert } from '@/components/Alert';

type Me = { email: string; name: string; role: string };
const b64ToU8 = (b64: string) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const isIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';

export default function StaffPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<StaffToday | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; title: string } | null>(null);
  const [push, setPush] = useState<'unsupported' | 'unconfigured' | 'off' | 'on' | 'denied' | 'busy'>('busy');
  const [ios, setIos] = useState(false); const [standalone, setStandalone] = useState(true);
  const [busyTask, setBusyTask] = useState('');

  const load = useCallback(() => api<StaffToday>('/staff/today').then(setData).catch((e) => setErr(e instanceof ApiError && e.status === 403 ? 'This page is for staff and admin accounts.' : e.message)), []);
  useEffect(() => {
    api<{ user: Me }>('/auth/me').then((r) => setMe(r.user)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    setIos(isIos()); setStandalone(isStandalone());
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setPush('unsupported');
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const key = await api<{ publicKey: string | null; configured: boolean }>('/staff/push/vapid-public-key');
        if (!key.configured) return setPush('unconfigured');
        if (Notification.permission === 'denied') return setPush('denied');
        const sub = await reg.pushManager.getSubscription();
        setPush(sub ? 'on' : 'off');
      } catch { setPush('unsupported'); }
    })();
    return () => clearInterval(t);
  }, [load]);

  async function enablePush() {
    setPush('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setPush('denied');
      const key = await api<{ publicKey: string }>('/staff/push/vapid-public-key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key.publicKey) });
      await api('/staff/push/subscribe', { method: 'POST', body: sub.toJSON() });
      setPush('on'); setMsg({ kind: 'success', title: 'Notifications on. You will be pinged when the rate is ready to share.' });
    } catch (e) { setPush('off'); setMsg({ kind: 'error', title: `Could not enable notifications: ${(e as Error).message}` }); }
  }
  async function disablePush() {
    setPush('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('/staff/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setPush('off');
    } catch { setPush('on'); }
  }

  async function copyCaption(text: string) {
    try { await navigator.clipboard.writeText(text); setMsg({ kind: 'success', title: 'Caption copied.' }); } catch { window.prompt('Copy the caption:', text); }
  }
  async function share() {
    if (!data?.ready) return;
    try {
      const blob = await fetch(data.feedUrl).then((r) => r.blob());
      const file = new File([blob], `chheda-gold-rate-${data.date}.jpg`, { type: 'image/jpeg' });
      await navigator.clipboard.writeText(data.caption).catch(() => {});
      const nav = navigator as any;
      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], text: data.caption, title: 'Chheda Jewellers – Gold Rate' });
        setMsg({ kind: 'success', title: 'Shared. Caption is also on your clipboard – paste it if the app dropped it. Then tap "Mark posted".' });
      } else setMsg({ kind: 'warning', title: 'Sharing files is not supported here. Use "Save image" and "Copy caption" below.' });
    } catch (e) { if ((e as Error).name !== 'AbortError') setMsg({ kind: 'error', title: (e as Error).message }); }
  }
  async function markPosted(id: string) {
    setBusyTask(id);
    try { await api(`/staff/tasks/${id}/mark-posted`, { method: 'POST' }); await load(); setMsg({ kind: 'success', title: 'Marked as posted. Thank you!' }); }
    catch (e) { setMsg({ kind: 'error', title: (e as Error).message }); await load(); }
    finally { setBusyTask(''); }
  }
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }

  const pending = data?.ready ? data.tasks.filter((t) => t.status !== 'success').length : 0;
  return (
    <div className="space-y-4 rise">
      <header className="flex items-center justify-between rounded-full border border-emerald-900/10 bg-cream/95 px-3 py-2 text-emerald-900">
        <span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-900 font-serif text-cream">C</span><span className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em]">Chheda · Staff</span></span>
        <span className="flex items-center gap-2">
          {me && <span className="hidden text-[10px] uppercase tracking-wider text-emerald-900/70 sm:inline">{me.name}</span>}
          {me?.role === 'admin' && <a href="/" className="text-[10px] font-semibold uppercase tracking-wider text-emerald-900/70 underline">Admin</a>}
          <button onClick={logout} className="rounded-full border border-copper/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-copper-600">Log out</button>
        </span>
      </header>

      {err && <Alert kind="error" title={err} />}
      {msg && <Alert {...msg} />}

      {!data ? <p className="text-sand">Loading…</p> : !data.ready ? (
        <section className="card space-y-2 text-center">
          <p className="eyebrow">{fmtDate(data.date)}</p>
          <h1 className="font-serif text-3xl font-light">Nothing to share yet</h1>
          <p className="text-sm text-cream-200/80">{data.message}</p>
          <p className="hint">This page only ever shows today&apos;s approved rate – never an old one. It refreshes every minute.</p>
          <button className="btn-secondary btn-sm mx-auto" onClick={load}>Refresh</button>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <div><p className="eyebrow">{fmtDate(data.date)}</p><h1 className="font-serif text-3xl font-light">Today&apos;s gold rate</h1></div>
              <span className="chip">{pending === 0 ? 'All posted ✓' : `${pending} to post`}</span>
            </div>
            <img src={data.feedUrl} alt="Today's gold rate" className="w-full rounded-2xl border border-cream-200/15 shadow-2xl" />
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary col-span-2" onClick={share}>Share image + caption</button>
              <button className="btn-secondary px-3" onClick={() => copyCaption(data.caption)}>Copy caption</button>
              <a className="btn-secondary px-3" href={data.feedUrl} download={`chheda-gold-rate-${data.date}.jpg`} target="_blank" rel="noreferrer">Save image</a>
              <a className="btn-secondary px-3" href="whatsapp://send" rel="noreferrer">WhatsApp ↗</a>
              <a className="btn-secondary px-3" href="instagram://app" rel="noreferrer">Instagram ↗</a>
            </div>
            <details className="surface px-3 py-2 text-sm"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-copper">Caption</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{data.caption}</pre></details>
            <details className="surface px-3 py-2 text-sm"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-copper">Story image</summary><img src={data.storyUrl} alt="Story" className="mx-auto mt-2 w-2/3 rounded-xl" /><a className="btn-secondary btn-sm mt-2" href={data.storyUrl} download target="_blank" rel="noreferrer">Save story</a></details>
          </section>

          <section className="space-y-2">
            <p className="eyebrow">Post to</p>
            {data.tasks.map((t) => {
              const info = MANUAL_CHANNEL_INFO[t.channel];
              const done = t.status === 'success';
              return (
                <div key={t.id} className={`surface flex items-center gap-3 p-3 ${done ? 'opacity-75' : ''}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm ${done ? 'bg-emerald-400/20 text-emerald-100' : 'bg-copper/20 text-peach'}`}>{done ? '✓' : info.app === 'instagram' ? 'IG' : 'WA'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{info.label}</p>
                    <p className="hint">{done ? `Posted by ${t.postedBy} at ${hhmm(t.postedAt)} IST` : info.hint}</p>
                  </div>
                  {!done && <button className="btn-primary btn-sm shrink-0" disabled={busyTask === t.id} onClick={() => markPosted(t.id)}>Mark posted</button>}
                </div>
              );
            })}
          </section>
        </>
      )}

      <section className="card space-y-2 text-sm">
        <p className="eyebrow">Notifications</p>
        {push === 'unsupported' && <p className="text-cream-200/80">Push is not available in this browser.{ios && !standalone && ' On iPhone, add this page to the Home Screen first (see below).'}</p>}
        {push === 'unconfigured' && <p className="text-cream-200/80">Push keys are not configured on the server yet (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).</p>}
        {push === 'denied' && <p className="text-amber-100">Notifications are blocked for this site. Allow them in your browser/phone settings, then reload.</p>}
        {push === 'off' && <><p className="text-cream-200/80">Get a ping at send time: &quot;Today&apos;s gold rate is ready to share&quot;, plus a reminder if something is still not posted.</p><button className="btn-primary btn-sm" onClick={enablePush}>Turn on notifications</button></>}
        {push === 'on' && <div className="flex items-center justify-between"><p className="text-emerald-100">Notifications are on for this device.</p><button className="btn-secondary btn-sm" onClick={disablePush}>Turn off</button></div>}
        {push === 'busy' && <p className="text-sand">…</p>}
      </section>

      {!standalone && (
        <section className="card space-y-2 text-sm">
          <p className="eyebrow">Add to Home Screen</p>
          {ios ? (
            <ol className="list-decimal space-y-1 pl-5 text-cream-200/80">
              <li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open the app from the Home Screen and turn on notifications. <b>On iPhone, push only works from the Home Screen app.</b></li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-cream-200/80">
              <li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu → <b>Add to Home screen</b> / <b>Install app</b>.</li><li>Open it from the Home Screen and turn on notifications.</li>
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
