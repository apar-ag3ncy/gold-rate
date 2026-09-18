'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/** Shared building blocks: loading skeletons, empty / error states, confirm modal, pager, page header. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-cream/10 ${className}`} />;
}
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card space-y-3" role="status" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-4 ${i % 2 ? 'w-2/3' : 'w-full'}`} />)}
    </div>
  );
}
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-copper/40 bg-cream/[0.03] px-4 py-8 text-center">
      <p className="text-sm font-medium text-cream-200">{title}</p>
      {hint && <p className="hint mt-1">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-400/25 text-xs font-bold">!</span>
      <span className="flex-1">{message}</span>
      {retry && <button className="btn-secondary btn-sm" onClick={retry}>Try again</button>}
    </div>
  );
}
export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="page-title">{title}</h1>{sub && <p className="text-sm text-cream-200/70">{sub}</p>}</div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm">
      <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
      <span className="text-sand">Page {page} of {pages} · {total} rows</span>
      <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </nav>
  );
}
/** Accessible confirm dialog (native <dialog>): Esc closes, focus moves inside, backdrop click cancels. */
export function Modal({ open, title, children, onClose, footer }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); else if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="w-[min(92vw,34rem)] rounded-2xl border border-cream-200/15 bg-emerald-900 p-0 text-cream shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm">
      <div className="p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-2xl font-light">{title}</h2>
        <div className="mt-3 space-y-3 text-sm">{children}</div>
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}
/** Suspense fallback that stops waiting: after `timeoutMs` it shows an error with Retry (reload) instead of an endless skeleton (BUG 3). */
export function LoadingGuard({ timeoutMs = 12_000, children }: { timeoutMs?: number; children?: React.ReactNode }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => { const t = setTimeout(() => setStuck(true), timeoutMs); return () => clearTimeout(t); }, [timeoutMs]);
  if (stuck) return <ErrorState message="This page is taking too long to load. Your connection may have dropped or an old version is cached." retry={() => window.location.reload()} />;
  return <>{children ?? <CardSkeleton lines={6} />}</>;
}
export function AdminOnly({ role, children }: { role?: string; children: React.ReactNode }) {
  if (!role) return <CardSkeleton />;
  if (role !== 'admin') return <EmptyState title="Admins only" hint="This page is only available to administrator accounts." action={<Link className="btn-secondary btn-sm" href="/">Back to dashboard</Link>} />;
  return <>{children}</>;
}
