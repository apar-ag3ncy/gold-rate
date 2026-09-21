'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ErrorState } from './ui';
import { api } from '@/lib/api';

type Me = { id: string; email: string; name: string; role: 'admin' | 'staff' | 'viewer' };
/** One /auth/me per page, shared with every page component. */
const SessionContext = createContext<{ me: Me | null }>({ me: null });
export const useSession = () => useContext(SessionContext);
const nav: { href: string; label: string; exact?: boolean; admin?: boolean }[] = [
  { href: '/', label: 'Rate' },
  { href: '/automation', label: 'Automation' },
];

/** Floating cream pill header – same treatment as chhedajewellers.com */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [clock, setClock] = useState('');

  const [chunkError, setChunkError] = useState(false);
  useEffect(() => { api<{ user: Me }>('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);
  // BUG 3 guards: (a) a failed JS chunk (stale deploy / flaky network) shows a banner with Retry instead of a dead page;
  // (b) any service worker left by older builds is removed – pages must never be served by a SW.
  useEffect(() => {
    const isChunk = (m: string) => /ChunkLoadError|Loading chunk [^ ]* failed|Failed to fetch dynamically imported module/i.test(m);
    const onErr = (e: ErrorEvent) => { if (isChunk(String(e.message))) setChunkError(true); };
    const onRej = (e: PromiseRejectionEvent) => { if (isChunk(String(e.reason?.message ?? e.reason))) setChunkError(true); };
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej);
    navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, []);
  useEffect(() => {
    const t = () => setClock(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }));
    t(); const id = setInterval(t, 30_000); return () => clearInterval(id);
  }, []);

  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only-focusable fixed left-2 top-2 z-50 rounded-full bg-cream px-3 py-1 text-xs text-emerald-900">Skip to content</a>
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="mx-auto max-w-6xl rounded-[28px] border border-emerald-900/10 bg-cream/95 px-3 py-2 text-emerald-900 shadow-[0_20px_50px_-25px_rgba(0,0,0,.7)] backdrop-blur-xl sm:rounded-full sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2.5 pl-1">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-emerald-900/15 bg-emerald-900 font-serif text-lg text-cream">C</span>
              <span className="leading-none">
                <span className="block font-sans text-[13px] font-semibold uppercase tracking-[0.2em] text-emerald-900">Chheda</span>
                <span className="block font-sans text-[8px] font-medium uppercase tracking-[0.35em] text-emerald-900/70">Jewellers · Gold rate</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {nav.filter((n) => !n.admin || me?.role === 'admin').map((n) => {
                const active = n.href === '/' || n.exact ? path === n.href : path.startsWith(n.href);
                return (
                  <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap rounded-full px-3.5 py-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[0.18em] transition ${active ? 'bg-emerald-900 text-cream shadow-sm' : 'text-emerald-900/75 hover:bg-emerald-900/8 hover:text-emerald-900'}`}>
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              {clock && <span className="hidden font-sans text-[10px] uppercase tracking-[0.14em] text-emerald-900/60 xl:inline">{clock} IST</span>}
              {me && <span className="hidden rounded-full border border-emerald-900/15 px-2.5 py-1 font-sans text-[10px] uppercase tracking-[0.14em] text-emerald-900/80 md:inline">{me.name} · {me.role}</span>}
              <button onClick={logout} className="rounded-full border border-copper/60 bg-copper/10 px-3.5 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-copper-600 transition hover:bg-copper/25">Log out</button>
            </div>
          </div>
          <nav className="mt-2 flex items-center gap-1 overflow-x-auto pb-1 lg:hidden">
            {nav.filter((n) => !n.admin || me?.role === 'admin').map((n) => {
              const active = n.href === '/' || n.exact ? path === n.href : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-full px-3.5 py-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[0.18em] transition ${active ? 'bg-emerald-900 text-cream shadow-sm' : 'text-emerald-900/75 hover:bg-emerald-900/8'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:py-10 rise">
        {chunkError && <div className="mb-4"><ErrorState message="Part of the app failed to load (a new version may have been deployed). Reload to continue." retry={() => window.location.reload()} /></div>}
        <SessionContext.Provider value={{ me }}>{children}</SessionContext.Provider>
      </main>
    </div>
  );
}
