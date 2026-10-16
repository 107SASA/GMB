'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { TrialOfferCard, FailurePolicyCard, RemindersCard, type PolicyResponse } from '@/components/admin/billing/PolicyCards';
import { SubscriptionsMonitor } from '@/components/admin/billing/SubscriptionsMonitor';
import { ReviewQueue } from '@/components/admin/billing/ReviewQueue';

const TABS = [
  { id: 'policy', label: 'Policies' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'review', label: 'Needs review' },
] as const;

/**
 * Super-admin billing controls: the free-trial offer, the failed-payment
 * policy, WhatsApp payment reminders, subscription monitoring and the
 * needs-review queue. Every change goes through the audited, server-validated
 * /api/admin/billing-policy and /api/admin/billing/* routes (super admin only).
 */
export default function AdminBillingPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('policy');
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [yearlyPrice, setYearlyPrice] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/billing-policy').then((r) => r.json()).catch(() => null);
    if (res?.success) setPolicy(res);
    else setLoadError('Could not load the billing policy.');
    const plans = await fetch('/api/billing/plans').then((r) => r.json()).catch(() => null);
    const yearly = plans?.plan?.durations?.find((d: any) => d.cycle === 'yearly');
    setYearlyPrice(yearly?.priceInr ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (section: 'trial' | 'failure' | 'reminders', value: unknown): Promise<string | null> => {
    const res = await fetch('/api/admin/billing-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [section]: value }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) return json.error || 'Could not save.';
    await load();
    return null;
  }, [load]);

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-heading text-2xl font-bold text-on-surface">Billing controls</h1>
        <p className="text-sm text-on-surface-variant">Free trial, failed payments, payment reminders and subscription monitoring.</p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-error-container bg-error-container/40 p-4 text-sm text-on-error-container" role="note">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Not production-verified yet. Keep the free trial and WhatsApp reminders <strong>OFF</strong> until the Razorpay test-mode checklist and the WhatsApp delivery test have both passed.
        </span>
      </div>

      <div className="flex gap-1 border-b border-outline-variant" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'policy' && (
        loadError ? <p className="text-sm text-error">{loadError}</p> : !policy ? <p className="text-sm text-outline">Loading…</p> : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <TrialOfferCard key={`t${policy.version}`} data={policy} yearlyPriceInr={yearlyPrice} save={save} />
            <FailurePolicyCard key={`f${policy.version}`} data={policy} save={save} />
            <div className="xl:col-span-2"><RemindersCard key={`r${policy.version}`} data={policy} save={save} /></div>
          </div>
        )
      )}
      {tab === 'subscriptions' && <SubscriptionsMonitor onChanged={load} />}
      {tab === 'review' && <ReviewQueue onChanged={load} />}
    </div>
  );
}
