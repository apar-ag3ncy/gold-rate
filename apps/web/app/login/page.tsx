'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally { setBusy(false); }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(800px 500px at 50% -10%, rgba(26,92,71,.7), transparent 60%), radial-gradient(500px 300px at 90% 100%, rgba(198,141,97,.15), transparent 60%)' }} />
      <form onSubmit={submit} className="glass relative w-full max-w-sm p-8 rise">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-copper/40 bg-cream font-serif text-xl text-emerald-900">C</span>
          <p className="eyebrow">For a generation in Mumbai</p>
          <h1 className="mt-1 font-serif text-4xl font-light text-cream">Chheda Jewellers</h1>
          <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.3em] text-sand">Gold rate admin</p>
        </div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required className="input mb-4" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required className="input mb-5" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="mb-3 rounded-xl border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="mt-5 text-center text-[10px] uppercase tracking-[0.14em] text-sand/80">Official Meta APIs only · rates published exactly as entered</p>
      </form>
    </main>
  );
}
