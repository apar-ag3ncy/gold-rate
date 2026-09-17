'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Me = { email: string; name: string; role: 'admin' | 'staff' | 'viewer' };
const nav = [
  { href: '/', label: 'Dashboard' },
  { href: '/rates', label: 'Enter Rate' },
  { href: '/history', label: 'History' },
  { href: '/subscribers', label: 'Subscribers' },
  { href: '/settings', label: 'Settings', exact: true },
  { href: '/settings/connections', label: 'Connections' },
];

/** Floating cream pill header – same treatment as chhedajewellers.com */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [clock, setClock] = useState('');

  useEffect(() => { api<{ user: Me }>('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);
  useEffect(() => {
    const t = () => setClock(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }));
    t(); const id = setInterval(t, 30_000); return () => clearInterval(id);
  }, []);

  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="mx-auto max-w-6xl rounded-[28px] border border-emerald-900/10 bg-cream/95 px-3 py-2 text-emerald-900 shadow-[0_20px_50px_-25px_rgba(0,0,0,.7)] backdrop-blur-xl sm:rounded-full sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2.5 pl-1">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-emerald-900/15 bg-emerald-900 font-serif text-lg text-cream">C</span>
              <span className="leading-none">
                <span className="block font-sans text-[13px] font-semibold uppercase tracking-[0.2em] text-emerald-900">Chheda</span>
                <span className="block font-sans text-[8px] font-medium uppercase tracking-[0.35em] text-emerald-900/70">Jewellers · Rates</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {nav.map((n) => {
                const active = n.href === '/' || (n as any).exact ? path === n.href : path.startsWith(n.href);
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
            {nav.map((n) => {
              const active = n.href === '/' || (n as any).exact ? path === n.href : path.startsWith(n.href);
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
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10 rise">{children}</main>
    </div>
  );
}
