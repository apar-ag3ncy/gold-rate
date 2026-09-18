import { fmtDate, fmtDateTime, inr } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

export type Rate = {
  date: string; k24: number; k22: number; k18: number;
  extraPurities: { label: string; value: number }[];
  status: string; enteredBy?: string; approvedBy?: string; approvedAt?: string; updatedAt: string;
  validation: { warnings: string[] };
};

export function RateCard({ title, date, rate, action }: { title: string; date: string; rate: Rate | null; action?: React.ReactNode }) {
  return (
    <section className="card flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="mt-0.5 font-serif text-lg text-cream">{fmtDate(date)}</p>
        </div>
        <StatusBadge status={rate?.status ?? 'missing'} />
      </div>
      {rate ? (
        <>
          <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {([['24K', rate.k24, true], ['22K', rate.k22, false], ['18K', rate.k18, false]] as const).map(([k, v, hero]) => (
              <div key={k} className={`flex items-center justify-between gap-2 rounded-xl border p-3 sm:block ${hero ? 'border-copper/45 bg-copper/10' : 'border-cream-200/12 bg-cream/[0.04]'}`}>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-copper">{k} Gold</dt>
                <dd className="kbd-money whitespace-nowrap text-lg font-bold leading-tight sm:mt-0.5 sm:text-xl">{inr(v)}<span className="ml-0.5 text-xs font-normal text-sand">/g</span></dd>
              </div>
            ))}
          </dl>
          {rate.extraPurities.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {rate.extraPurities.map((p) => <span key={p.label} className="chip"><b className="text-copper">{p.label}</b> {inr(p.value)}/g</span>)}
            </div>
          )}
          <p className="hint mt-3">
            Updated {fmtDateTime(rate.updatedAt)} · {rate.enteredBy}
            {rate.approvedBy && <> · approved by <b>{rate.approvedBy}</b></>}
          </p>
        </>
      ) : (
        <p className="rounded-xl border border-red-300/30 bg-red-500/10 p-3 text-sm text-red-200">No rate entered yet. Nothing will be sent for this day until a rate is saved and approved.</p>
      )}
      {action && <div className="mt-4 flex justify-end">{action}</div>}
    </section>
  );
}
