const styles = {
  error: { box: 'border-red-300/30 bg-red-500/10 text-red-100', icon: '✕', ring: 'bg-red-400/25 text-red-100' },
  warning: { box: 'border-amber-300/30 bg-amber-400/10 text-amber-50', icon: '!', ring: 'bg-amber-300/25 text-amber-100' },
  success: { box: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-50', icon: '✓', ring: 'bg-emerald-300/25 text-emerald-100' },
};
export function Alert({ kind, title, items }: { kind: 'error' | 'warning' | 'success'; title: string; items?: string[] }) {
  const s = styles[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-md rise ${s.box}`}>
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.ring}`}>{s.icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        {items && items.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 opacity-90">{items.map((i) => <li key={i}>{i}</li>)}</ul>}
      </div>
    </div>
  );
}
