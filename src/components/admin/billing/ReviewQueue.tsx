'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SubscriptionDetail } from './SubscriptionsMonitor';

function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function Group({ title, hint, count, children }: { title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-outline-variant p-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-bold text-on-surface">{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${count ? 'bg-error-container text-on-error-container' : 'bg-surface text-outline'}`}>{count}</span>
      </div>
      <p className="mb-2 text-xs text-outline">{hint}</p>
      {count === 0 ? <p className="text-xs text-outline">Nothing here.</p> : <ul className="space-y-1.5">{children}</ul>}
    </div>
  );
}

export function ReviewQueue({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/billing/recovery').then((r) => r.json()).catch(() => null);
    if (res?.success) setData(res);
  }, []);
  useEffect(() => { load(); }, [load]);

  const markReviewed = async (kind: 'episode' | 'billingEvent' | 'trialClaim', id: string) => {
    setError(null);
    const note = (document.getElementById(`note-${kind}-${id}`) as HTMLInputElement | null)?.value ?? '';
    const res = await fetch('/api/admin/billing/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, note }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not mark reviewed.');
    await load();
    onChanged?.();
  };

  const Review = ({ kind, id }: { kind: 'episode' | 'billingEvent' | 'trialClaim'; id: string }) => (
    <span className="flex items-center gap-1.5">
      <input id={`note-${kind}-${id}`} placeholder="Note (optional)" aria-label="Review note" className="w-40 rounded-md border border-outline-variant bg-surface px-2 py-1 text-xs" />
      <button type="button" onClick={() => markReviewed(kind, id)} className="rounded-md border border-outline-variant px-2 py-1 text-xs font-semibold hover:bg-surface">Mark reviewed</button>
    </span>
  );
  const Item = ({ children, businessId }: { children: React.ReactNode; businessId?: string | null }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-2.5 py-1.5 text-xs">
      <span>{children}</span>
      {businessId && <button type="button" onClick={() => setOpen(businessId)} className="text-xs font-semibold text-primary underline">History</button>}
    </li>
  );

  const nr = data?.needsReview;
  const flaggedEpisodes = (data?.episodes ?? []).filter((e: any) => e.needsReview);
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 card-shadow">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold text-on-surface">Needs review</h2>
        <button type="button" onClick={load} aria-label="Refresh" className="rounded-lg border border-outline-variant p-2 text-on-surface-variant hover:bg-surface"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <p className="mb-4 text-xs text-outline">
        &ldquo;Mark reviewed&rdquo; only records that a person looked — it never changes a subscription, access, or a trial claim, and never re-sends a WhatsApp message. Releasing a held recovery is a separate action in the subscription&apos;s detail.
      </p>
      {error && <p role="alert" className="mb-3 text-xs text-error">{error}</p>}
      {!data ? <p className="text-sm text-outline">Loading…</p> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Group title="Razorpay recovery operations" hint="Failed or ambiguous: no replacement subscription was created." count={nr.billingOperations.length}>
            {nr.billingOperations.map((o: any) => (
              <Item key={o.id} businessId={o.businessId}>
                <strong>{o.businessName ?? o.businessId}</strong> · {o.type} · {fmt(o.at)}<br /><span className="text-outline">{o.note}</span>
                <span className="mt-1 block"><Review kind="billingEvent" id={o.id} /></span>
              </Item>
            ))}
          </Group>
          <Group title="Ambiguous WhatsApp sends" hint="Outcome unknown — never retried automatically (at most one message per step)." count={(nr.ambiguousSends ?? []).filter((s: any) => !s.reviewed).length}>
            {(nr.ambiguousSends ?? []).filter((s: any) => !s.reviewed).map((s: any) => (
              <Item key={`${s.episodeId}-${s.step}`} businessId={s.businessId}>
                <strong>{s.businessName ?? s.businessId}</strong> · {s.step} · {fmt(s.at)}<br /><span className="text-outline">{s.reason}</span>
                <span className="mt-1 block"><Review kind="episode" id={s.episodeId} /></span>
              </Item>
            ))}
          </Group>
          <Group title="Flagged reminder episodes" hint="Episodes with a step that needs a look." count={flaggedEpisodes.filter((e: any) => !(nr.ambiguousSends ?? []).some((s: any) => s.episodeId === e.id)).length}>
            {flaggedEpisodes.filter((e: any) => !(nr.ambiguousSends ?? []).some((s: any) => s.episodeId === e.id)).map((e: any) => (
              <Item key={e.id} businessId={e.businessId}>
                <strong>{e.businessName ?? e.businessId}</strong> · {e.status}
                <span className="mt-1 block"><Review kind="episode" id={e.id} /></span>
              </Item>
            ))}
          </Group>
          <Group title="Trial claims in doubt" hint="Razorpay's answer was ambiguous; the phone's claim stays reserved." count={nr.trialClaims.length}>
            {nr.trialClaims.map((c: any) => (
              <Item key={c.id} businessId={c.businessId}>
                {c.subscriptionId ?? '—'} · since {fmt(c.since)}
                <span className="mt-1 block"><Review kind="trialClaim" id={c.id} /></span>
              </Item>
            ))}
          </Group>
          <Group title="Recoveries on hold" hint="Paid again; access waits for a super admin (open History to release)." count={nr.recoveriesOnHold.length}>
            {nr.recoveriesOnHold.map((h: any) => <Item key={h.businessId} businessId={h.businessId}><strong>{h.name}</strong> · since {fmt(h.since)}</Item>)}
          </Group>
          <Group title="Past due without a reminder episode" hint="Failures that pre-date reminders, or whose episode could not be opened." count={nr.failuresWithoutEpisode.length}>
            {nr.failuresWithoutEpisode.map((f: any) => <Item key={f.businessId} businessId={f.businessId}><strong>{f.name}</strong> · failed {fmt(f.failedAt)} · {f.kind ?? '—'}</Item>)}
          </Group>
          <Group title="Stuck trial checkout reservations" hint="The 24-hour window passed; settled on the next checkout attempt after Razorpay confirms." count={(nr.stuckTrialReservations ?? []).length}>
            {(nr.stuckTrialReservations ?? []).map((c: any) => <Item key={c.id} businessId={c.businessId}>{c.subscriptionId ?? 'no subscription'} · window ended {fmt(c.reservedUntil)}</Item>)}
          </Group>
          <Group title="Expired recovery checkouts" hint="A replacement checkout expired unpaid; the customer can retry from Billing." count={(nr.expiredRecoveryCheckouts ?? []).length}>
            {(nr.expiredRecoveryCheckouts ?? []).map((c: any) => <Item key={c.businessId} businessId={c.businessId}><strong>{c.name}</strong> · {c.subscriptionId} · expired {fmt(c.expiredAt)}</Item>)}
          </Group>
        </div>
      )}
      {open && <SubscriptionDetail businessId={open} onClose={() => setOpen(null)} onChanged={() => { load(); onChanged?.(); }} />}
    </section>
  );
}
