'use client';
import Link from 'next/link';
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass max-w-md p-8 text-center" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-1 font-serif text-3xl font-light">The page could not be shown</h1>
        <p className="mt-2 text-sm text-cream-200/80">Nothing was sent or changed because of this. {error.digest && <span className="text-sand">Reference: {error.digest}</span>}</p>
        <div className="mt-5 flex justify-center gap-2"><button className="btn-primary" onClick={reset}>Try again</button><Link className="btn-secondary" href="/">Dashboard</Link></div>
      </div>
    </main>
  );
}
