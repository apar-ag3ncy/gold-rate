'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, fmtDateTime } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { AdminOnly, CardSkeleton, EmptyState, ErrorState, Modal, PageHeader } from '@/components/ui';

type U = { id: string; email: string; name: string; role: 'admin' | 'staff' | 'viewer'; disabled: boolean; lockedUntil?: string; lastLoginAt?: string; createdAt: string; activeSessions: number };
const roleHint = { admin: 'Enters and approves rates, changes settings, manages users.', staff: 'Uses the staff share app and can acknowledge alerts.', viewer: 'Read-only dashboard access.' };

export default function UsersPage() {
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [items, setItems] = useState<U[] | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; title: string } | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'staff' as U['role'] });
  const [busy, setBusy] = useState('');
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; run: () => Promise<void> } | null>(null);
  useEffect(() => { api<{ user: { id: string; role: string } }>('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);
  const load = () => api<{ items: U[] }>('/users').then((r) => { setItems(r.items); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { if (me?.role === 'admin') load(); }, [me]);
  const fail = (e: unknown) => setMsg({ kind: 'error', title: e instanceof ApiError ? `${e.message}${e.details?.fields ? ' – ' + Object.values(e.details.fields).join(', ') : ''}` : (e as Error).message });

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy('add'); setMsg(null);
    try { const r = await api<{ item: U; firstPassword: string }>('/users', { method: 'POST', body: form }); setSecret({ title: 'User created', email: r.item.email, password: r.firstPassword }); setForm({ email: '', name: '', role: 'staff' }); await load(); }
    catch (er) { fail(er); } finally { setBusy(''); }
  }
  const act = (id: string, fn: () => Promise<void>) => async () => { setBusy(id); setMsg(null); try { await fn(); await load(); } catch (er) { fail(er); } finally { setBusy(''); setConfirm(null); } };

  return (
    <div className="space-y-5">
      <PageHeader title="Users" sub="Who can log in, and with which role. Passwords are shown once and never stored in plain text." />
      <AdminOnly role={me?.role}>
        {msg && <Alert {...msg} />}
        {err && <ErrorState message={err} retry={load} />}
        <form className="card grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end" onSubmit={add}>
          <div><label className="label" htmlFor="ne">Email</label><input id="ne" type="email" required className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label" htmlFor="nn">Name</label><input id="nn" required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="nr">Role</label><select id="nr" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as U['role'] })}><option value="admin">admin</option><option value="staff">staff</option><option value="viewer">viewer</option></select></div>
          <button className="btn-primary" disabled={busy === 'add'}>{busy === 'add' ? 'Creating…' : 'Add user'}</button>
          <p className="hint sm:col-span-4">{roleHint[form.role]} A first password is generated and shown once – share it privately and ask them to change it.</p>
        </form>
        {!items ? <CardSkeleton lines={5} /> : items.length === 0 ? <EmptyState title="No users" /> : (
          <section className="card p-0 sm:p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-cream-200/15 bg-cream/[0.04] text-[11px] uppercase tracking-wider text-sand"><tr><th className="px-4 py-3">User</th><th className="pr-3">Role</th><th className="pr-3">Status</th><th className="pr-3">Last login</th><th className="pr-3">Sessions</th><th /></tr></thead>
                <tbody>
                  {items.map((u) => {
                    const self = u.id === me?.id;
                    return (
                      <tr key={u.id} className={`border-b border-cream-200/10 ${u.disabled ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2.5"><p className="font-medium">{u.name}{self && <span className="ml-2 chip">you</span>}</p><p className="text-xs text-cream-200/70">{u.email}</p></td>
                        <td className="pr-3"><label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.email}</label><select id={`role-${u.id}`} className="input py-1" value={u.role} disabled={self || !!busy} onChange={(e) => act(u.id, () => api(`/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }))()}><option value="admin">admin</option><option value="staff">staff</option><option value="viewer">viewer</option></select></td>
                        <td className="pr-3 text-xs">{u.disabled ? <span className="text-red-200">disabled</span> : u.lockedUntil ? <span className="text-amber-200">locked until {fmtDateTime(u.lockedUntil)}</span> : <span className="text-emerald-200">active</span>}</td>
                        <td className="whitespace-nowrap pr-3 text-xs">{fmtDateTime(u.lastLoginAt)}</td>
                        <td className="pr-3 kbd-money">{u.activeSessions}</td>
                        <td className="pr-4"><div className="flex flex-wrap justify-end gap-1.5">
                          <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm({ title: 'Reset password?', text: `A new password for ${u.email} will be generated and shown once. Their current sessions end.`, run: act(u.id, async () => { const r = await api<{ newPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }); setSecret({ title: 'Password reset', email: u.email, password: r.newPassword }); }) })}>Reset password</button>
                          <button className="btn-secondary btn-sm" disabled={!!busy || u.activeSessions === 0} onClick={act(u.id, () => api(`/users/${u.id}/logout`, { method: 'POST' }))}>Force logout</button>
                          {!self && <button className={`${u.disabled ? 'btn-secondary' : 'btn-danger'} btn-sm`} disabled={!!busy} onClick={() => u.disabled ? act(u.id, () => api(`/users/${u.id}`, { method: 'PATCH', body: { disabled: false } }))() : setConfirm({ title: 'Disable this user?', text: `${u.email} will be logged out everywhere and cannot sign in until enabled again.`, run: act(u.id, () => api(`/users/${u.id}`, { method: 'PATCH', body: { disabled: true } })) })}>{u.disabled ? 'Enable' : 'Disable'}</button>}
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <Modal open={!!secret} title={secret?.title ?? ''} onClose={() => setSecret(null)} footer={<button className="btn-primary" onClick={() => setSecret(null)}>Done</button>}>
          <p>Share this with <b>{secret?.email}</b> privately. It will not be shown again.</p>
          <p className="rounded-xl border border-copper/40 bg-emerald-950/60 px-3 py-2 font-mono text-lg tracking-wide select-all">{secret?.password}</p>
          <button className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(secret?.password ?? '').catch(() => {})}>Copy</button>
        </Modal>
        <Modal open={!!confirm} title={confirm?.title ?? ''} onClose={() => setConfirm(null)} footer={<><button className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="btn-primary" onClick={() => confirm?.run()}>Confirm</button></>}>
          <p>{confirm?.text}</p>
        </Modal>
      </AdminOnly>
    </div>
  );
}
