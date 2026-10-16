'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, X, ShieldCheck } from 'lucide-react';
import { MODULE_LABELS } from '@/components/billing/useRazorpayCheckout';
import { ConfirmDialog } from './ConfirmDialog';

type Row = any;

const STATUS_LABEL: Record<string, string> = {
  trial: 'Trial',
  trial_cancelled: 'Trial (cancelled)',
  paid: 'Paid',
  held: 'Paid — held',
  past_due_grace: 'Past due (grace)',
  past_due_restricted: 'Past due (restricted)',
  cancelled: 'Cancelled',
  never_paid: 'Never paid',
};
const STATUS_STYLE: Record<string, string> = {
  trial: 'bg-primary-fixed text-primary border-primary-fixed-dim',
  trial_cancelled: 'bg-surface text-on-surface-variant border-outline-variant',
  paid: 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
  held: 'bg-primary-fixed text-primary border-primary-fixed-dim',
  past_due_grace: 'bg-error-container/50 text-on-error-container border-error-container',
  past_due_restricted: 'bg-error-container text-on-error-container border-error-container',
  cancelled: 'bg-surface text-on-surface-variant border-outline-variant',
  never_paid: 'bg-surface text-outline border-outline-variant',
};

function fmt(d: string | null | undefined, withTime = false) {
  if (!d) return '—';
  const date = new Date(d);
  return withTime ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : date.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status] ?? STATUS_STYLE.never_paid}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function SubscriptionsMonitor({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; counts: Record<string, number>; pagination: any } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (status) params.set('status', status);
    if (query) params.set('q', query);
    const res = await fetch(`/api/admin/billing/subscriptions?${params}`).then((r) => r.json()).catch(() => null);
    if (res?.success) setData(res);
    setLoading(false);
  }, [page, status, query]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 card-shadow">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold text-on-surface">Subscriptions</h2>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q.trim()); }}
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-outline" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Workspace, owner or Razorpay id" aria-label="Search subscriptions" className="w-64 rounded-lg border border-outline-variant bg-surface py-2 pl-8 pr-3 text-sm focus:border-primary focus:outline-none" />
          </div>
          <button type="button" onClick={load} aria-label="Refresh" className="rounded-lg border border-outline-variant p-2 text-on-surface-variant hover:bg-surface">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
        <button type="button" onClick={() => { setStatus(''); setPage(1); }} className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === '' ? 'border-primary bg-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant'}`}>All billed</button>
        {Object.keys(STATUS_LABEL).map((s) => (
          <button key={s} type="button" onClick={() => { setStatus(s); setPage(1); }} className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === s ? 'border-primary bg-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant'}`}>
            {STATUS_LABEL[s]} <span className="text-outline">{data?.counts?.[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-outline-variant text-[11px] uppercase tracking-wide text-outline">
            <tr>
              <th className="py-2 pr-3">Workspace / owner</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Plan · last charge</th>
              <th className="py-2 pr-3">Trial end / next billing</th>
              <th className="py-2 pr-3">Payment failure</th>
              <th className="py-2 pr-3">Recovery</th>
              <th className="py-2 pr-3">Reminders</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.businessId} onClick={() => setSelected(r.businessId)} className="cursor-pointer border-b border-outline-variant/60 align-top hover:bg-surface">
                <td className="py-2.5 pr-3">
                  <div className="font-semibold text-on-surface">{r.workspace ?? '—'}</div>
                  <div className="text-xs text-outline">{r.owner?.name ?? '—'} {r.owner?.phone ? `· ${r.owner.phone}` : ''}</div>
                  <div className="font-mono text-[11px] text-outline">{r.razorpaySubscriptionId ?? 'no Razorpay subscription'}</div>
                </td>
                <td className="py-2.5 pr-3"><StatusBadge status={r.status} /></td>
                <td className="py-2.5 pr-3 text-xs">
                  {r.plan}
                  <div className="text-outline">{r.lastChargeInr != null ? `₹${r.lastChargeInr.toLocaleString('en-IN')} on ${fmt(r.lastChargeAt)}` : 'no charge recorded'}</div>
                </td>
                <td className="py-2.5 pr-3 text-xs">
                  {r.trialEndsAt ? <div>Trial ends {fmt(r.trialEndsAt)}</div> : null}
                  <div className="text-outline">Next: {fmt(r.nextBillingAt)}</div>
                </td>
                <td className="py-2.5 pr-3 text-xs">
                  {r.payment.failedAt ? (
                    <>
                      <div>{fmt(r.payment.failedAt, true)} · {r.payment.failureKind === 'first_charge' ? 'first charge' : 'renewal'}</div>
                      <div className="text-outline">{r.payment.graceEndsAt ? `grace until ${fmt(r.payment.graceEndsAt, true)}` : ''}</div>
                      {r.payment.restrictedModules && <div className="text-error">locked: {r.payment.restrictedModules.map((m: string) => MODULE_LABELS[m] ?? m).join(', ')}</div>}
                    </>
                  ) : '—'}
                </td>
                <td className="py-2.5 pr-3 text-xs">
                  {r.recovery.held ? <div className="font-semibold text-primary">Access held</div> : null}
                  {r.recovery.openCheckout ? <div>{r.recovery.openCheckout.expired ? 'Checkout expired' : 'Checkout open'}</div> : null}
                  {!r.recovery.held && !r.recovery.openCheckout ? '—' : null}
                </td>
                <td className="py-2.5 pr-3 text-xs">
                  {r.reminders ? (
                    <>
                      <div>{r.reminders.sent} sent · {r.reminders.episodeStatus}</div>
                      <div className="text-outline">{r.reminders.nextDueAt ? `next ${fmt(r.reminders.nextDueAt, true)}` : r.reminders.stopReason ?? ''}</div>
                      {r.reminders.lastDelivery && <div className="text-outline">last: {r.reminders.lastDelivery.status}{r.reminders.lastDelivery.delivery ? ` / ${r.reminders.lastDelivery.delivery}` : ''}</div>}
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-outline">No subscriptions match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data?.pagination?.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-outline-variant px-3 py-1 disabled:opacity-50">Previous</button>
          <span>Page {page} of {data?.pagination?.totalPages}</span>
          <button type="button" disabled={page >= (data?.pagination?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-outline-variant px-3 py-1 disabled:opacity-50">Next</button>
        </div>
      )}
      {selected && <SubscriptionDetail businessId={selected} onClose={() => setSelected(null)} onChanged={() => { load(); onChanged?.(); }} />}
    </section>
  );
}

export function SubscriptionDetail({ businessId, onClose, onChanged }: { businessId: string; onClose: () => void; onChanged?: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (verify = false) => {
    if (verify) setVerifying(true);
    const res = await fetch(`/api/admin/billing/subscriptions/${businessId}${verify ? '?verify=1' : ''}`).then((r) => r.json()).catch(() => null);
    if (res?.success) setDetail(res);
    setVerifying(false);
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const release = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/billing/release-hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmRelease(false);
    if (!res.ok) setError(json.error || 'Could not release the hold.');
    else { await load(); onChanged?.(); }
  };

  const row = detail?.row;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-surface-container-lowest p-5 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="Subscription detail">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-on-surface">{row?.workspace ?? 'Loading…'}</h3>
            {row && <div className="mt-1 flex items-center gap-2"><StatusBadge status={row.status} /><span className="font-mono text-xs text-outline">{row.razorpaySubscriptionId ?? '—'}</span></div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-outline hover:text-on-surface"><X className="h-5 w-5" /></button>
        </div>
        {row && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-outline">Owner</span><div>{row.owner?.name ?? '—'} · {row.owner?.phone ?? '—'} {row.owner?.phoneVerified ? '(verified)' : '(unverified)'}</div></div>
              <div><span className="text-outline">Plan</span><div>{row.plan}</div></div>
              <div><span className="text-outline">Paid through</span><div>{fmt(row.paidThrough)}</div></div>
              <div><span className="text-outline">Next billing</span><div>{fmt(row.nextBillingAt)}</div></div>
              <div><span className="text-outline">Access</span><div>{row.payment.accessMode}</div></div>
              <div><span className="text-outline">Last Razorpay event</span><div>{row.lastRazorpayEvent ? `${row.lastRazorpayEvent.type} · ${fmt(row.lastRazorpayEvent.at, true)}` : '—'}</div></div>
            </div>

            <div className="rounded-lg border border-outline-variant p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-on-surface">Razorpay (live, read-only)</span>
                <button type="button" onClick={() => load(true)} disabled={verifying || !row.razorpaySubscriptionId} className="rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold disabled:opacity-50">{verifying ? 'Checking…' : 'Verify status now'}</button>
              </div>
              {detail.razorpay ? (
                detail.razorpay.available ? (
                  <div className="text-xs">Status <strong>{detail.razorpay.status}</strong> · paid {detail.razorpay.paidCount} · current end {fmt(detail.razorpay.currentEnd)} · next charge {fmt(detail.razorpay.chargeAt)}</div>
                ) : (
                  <div className="text-xs text-error">Not available: {detail.razorpay.reason}</div>
                )
              ) : <div className="text-xs text-outline">Not checked in this view.</div>}
            </div>

            {row.recovery.held && (
              <div className="rounded-lg border border-primary bg-primary-fixed p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><ShieldCheck className="h-4 w-4" /> Paid again — access held for review</div>
                <button type="button" onClick={() => setConfirmRelease(true)} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white">Release hold</button>
                {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-outline">Billing history</h4>
              <ol className="space-y-1.5">
                {detail.events.map((e: any) => (
                  <li key={e.id} className="rounded-lg border border-outline-variant/60 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{e.type}</span>
                      <span className="text-outline">{e.source} · {fmt(e.at, true)}</span>
                    </div>
                    <div className="text-on-surface-variant">{e.statusBefore ?? '—'} → {e.statusAfter ?? '—'} {e.actions.length ? `· ${e.actions.join(', ')}` : ''} {e.amountInr != null ? `· ₹${e.amountInr}` : ''}</div>
                    {e.note && <div className="text-outline">{e.note}</div>}
                    {e.needsReview && <div className="font-semibold text-error">{e.reviewedAt ? `reviewed ${fmt(e.reviewedAt, true)}` : 'needs review'}</div>}
                  </li>
                ))}
                {detail.events.length === 0 && <li className="text-xs text-outline">No billing events recorded.</li>}
              </ol>
            </div>

            {detail.episodes.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-outline">Payment reminders</h4>
                {detail.episodes.map((ep: any) => (
                  <div key={ep.id} className="mb-2 rounded-lg border border-outline-variant/60 p-3 text-xs">
                    <div className="mb-1 font-semibold">Failure {fmt(ep.failedAt, true)} · {ep.status}{ep.stopReason ? ` (${ep.stopReason})` : ''} · {ep.remindersSent} sent</div>
                    <ul className="space-y-0.5">
                      {ep.steps.map((s: any) => (
                        <li key={s.key} className="flex flex-wrap gap-2">
                          <span className="w-8 font-mono">{s.key}</span>
                          <span>{s.status}</span>
                          <span className="text-outline">{s.sentAt ? fmt(s.sentAt, true) : `due ${fmt(s.nextAttemptAt, true)}`}</span>
                          {s.delivery && <span className="text-outline">delivery: {s.delivery}</span>}
                          {s.error && <span className="text-error">{s.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {detail.trialClaim && (
              <div className="text-xs">
                <h4 className="mb-1 font-bold uppercase tracking-wide text-outline">Free-trial claim</h4>
                {detail.trialClaim.status}{detail.trialClaim.offer ? ` · ${detail.trialClaim.offer.trialMonths} months until ${fmt(detail.trialClaim.offer.trialEndsAt)} · then ₹${detail.trialClaim.offer.amountInr}` : ''}
                {detail.trialClaim.needsReview && <span className="ml-2 font-semibold text-error">needs review</span>}
              </div>
            )}

            {detail.adminActions.length > 0 && (
              <div className="text-xs">
                <h4 className="mb-1 font-bold uppercase tracking-wide text-outline">Admin actions</h4>
                <ul className="space-y-0.5">{detail.adminActions.map((a: any, i: number) => <li key={i}>{a.action} · {a.by ?? '—'} · {fmt(a.at, true)}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        <ConfirmDialog open={confirmRelease} title="Release the recovery hold?" confirmLabel="Release hold" busy={busy} onCancel={() => setConfirmRelease(false)} onConfirm={release}>
          <p>This workspace has paid again and was held for review. Releasing restores full access now. This is recorded in the audit log.</p>
        </ConfirmDialog>
      </aside>
    </div>
  );
}
