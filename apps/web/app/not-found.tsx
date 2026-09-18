import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass max-w-md p-8 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-1 font-serif text-3xl font-light">This page does not exist</h1>
        <p className="mt-2 text-sm text-cream-200/80">The link may be old, or the page may have moved.</p>
        <Link className="btn-primary mt-5" href="/">Back to the dashboard</Link>
      </div>
    </main>
  );
}
