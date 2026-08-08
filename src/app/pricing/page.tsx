'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MODULE_LABELS,
  usePublicPlan,
  useRazorpayCheckout,
} from '@/components/billing/useRazorpayCheckout';
import { DurationPicker, pickDuration, getPreferredCycle, setPreferredCycle } from '@/components/billing/DurationPicker';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BRAND_ATTRIBUTION } from '@/lib/companyInfo';

/** One plan, one card — price and copy come from the super-admin config. */
export default function PricingPage() {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState(() => getPreferredCycle() ?? 'monthly');
  const { checkout, subscribe } = useRazorpayCheckout({
    onUnauthenticated: () => router.push('/login'),
    // Matches AuditPaywallSidebar/WorkspaceLockGate: redirect the instant the
    // webhook confirms activation instead of waiting on a manual click, and
    // force a fresh server render so a dashboard RSC payload cached from
    // before the subscription activated is never served stale.
    onActivated: () => {
      router.push('/dashboard');
      router.refresh();
    },
  });

  const busy = checkout.phase === 'starting' || checkout.phase === 'confirming';
  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? plan?.billingCycle ?? 'month';
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <div className="min-h-screen bg-background py-16 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="font-heading text-4xl font-bold text-on-surface tracking-tight">Simple pricing</h1>
          <p className="text-on-surface-variant mt-3 text-lg">
            One plan, everything included — dashboard and mobile app.
          </p>
        </div>

        {/* Checkout overlays */}
        {checkout.phase === 'confirming' && (
          <div className="mb-8 p-4 bg-primary-fixed border border-primary-fixed-dim rounded-xl flex items-center gap-3 text-primary">
            <MaterialIcon name="progress_activity" size={20} className="animate-spin shrink-0 text-primary" />
            Payment received — activating your plan…
          </div>
        )}
        {checkout.phase === 'success' && (
          <div className="mb-8 p-4 bg-secondary-container/40 border border-secondary-fixed rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-on-secondary-container">
              <MaterialIcon name="check_circle" size={20} className="shrink-0 text-on-secondary-container" />
              You're subscribed! All features are now unlocked.
            </div>
            <button
              onClick={() => { router.push('/dashboard'); router.refresh(); }}
              className="px-4 py-2 bg-secondary text-on-secondary text-sm font-bold rounded-lg hover:bg-tertiary-container shrink-0"
            >
              Go to dashboard
            </button>
          </div>
        )}
        {checkout.phase === 'error' && (
          <div className="mb-8 p-4 bg-error-container border border-error-container rounded-xl flex items-center gap-3 text-on-error-container">
            <MaterialIcon name="cancel" size={20} className="shrink-0 text-on-error-container" />
            {checkout.message}
          </div>
        )}

        {loading ? (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 animate-pulse h-96" />
        ) : plan ? (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 flex flex-col ring-2 ring-primary">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-heading text-xl font-bold text-on-surface">{plan.displayName}</h2>
              <span className="flex items-center gap-1 text-[11px] font-bold text-primary bg-primary-fixed border border-primary-fixed-dim px-2 py-0.5 rounded-lg">
                <MaterialIcon name="auto_awesome" size={12} className="text-primary" /> All features
              </span>
            </div>
            <p className="text-sm text-on-surface-variant mb-6">{plan.description}</p>
            {plan.durations?.length > 1 && (
              <DurationPicker
                durations={plan.durations}
                value={cycle}
                onChange={(c) => { setCycle(c); setPreferredCycle(c); }}
              />
            )}
            <div className="mb-6">
              <span className="font-heading text-4xl font-bold text-on-surface">
                ₹{(price ?? plan.priceInr).toLocaleString('en-IN')}
              </span>
              <span className="text-outline text-sm"> / {cycleLabel}</span>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {(features.length ? features : plan.modules.map((m) => MODULE_LABELS[m] ?? m)).map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-on-surface">
                  <MaterialIcon name="check_circle" size={16} className="text-secondary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => subscribe(cycle)}
              disabled={!plan.available || busy}
              className="w-full py-3 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-container disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {checkout.phase === 'starting' && (
                <MaterialIcon name="progress_activity" size={16} className="animate-spin text-on-primary" />
              )}
              {plan.available ? 'Subscribe now' : 'Coming soon'}
            </button>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 text-center text-sm text-on-surface-variant">
            Pricing is unavailable right now — please try again shortly.
          </div>
        )}

        <p className="text-center text-xs text-outline mt-10">
          Payments are processed securely by Razorpay. Cancel anytime from your dashboard billing page.
        </p>
        <p className="text-center text-xs text-outline mt-1">{BRAND_ATTRIBUTION}</p>
      </div>
    </div>
  );
}
