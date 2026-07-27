'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';
import {
  MODULE_LABELS,
  usePublicPlan,
  useRazorpayCheckout,
} from '@/components/billing/useRazorpayCheckout';
import { DurationPicker, pickDuration } from '@/components/billing/DurationPicker';

/** One plan, one card — price and copy come from the super-admin config. */
export default function PricingPage() {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState('monthly');
  const { checkout, subscribe } = useRazorpayCheckout({
    onUnauthenticated: () => router.push('/login'),
  });

  const busy = checkout.phase === 'starting' || checkout.phase === 'confirming';
  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? plan?.billingCycle ?? 'month';
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <div className="min-h-screen bg-slate-50 py-16 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Simple pricing</h1>
          <p className="text-slate-500 mt-3 text-lg">
            One plan, everything included — dashboard and mobile app.
          </p>
        </div>

        {/* Checkout overlays */}
        {checkout.phase === 'confirming' && (
          <div className="mb-8 p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-3 text-indigo-700">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" />
            Payment received — activating your plan…
          </div>
        )}
        {checkout.phase === 'success' && (
          <div className="mb-8 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              You're subscribed! All features are now unlocked.
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 shrink-0"
            >
              Go to dashboard
            </button>
          </div>
        )}
        {checkout.phase === 'error' && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
            <XCircle className="w-5 h-5 shrink-0" />
            {checkout.message}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 animate-pulse h-96" />
        ) : plan ? (
          <div className="bg-white rounded-2xl border border-indigo-300 ring-2 ring-indigo-100 p-8 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-slate-900">{plan.displayName}</h2>
              <span className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" /> All features
              </span>
            </div>
            <p className="text-sm text-slate-500 mb-6">{plan.description}</p>
            {plan.durations?.length > 1 && (
              <DurationPicker durations={plan.durations} value={cycle} onChange={setCycle} />
            )}
            <div className="mb-6">
              <span className="text-4xl font-bold text-slate-900">
                ₹{(price ?? plan.priceInr).toLocaleString('en-IN')}
              </span>
              <span className="text-slate-400 text-sm"> / {cycleLabel}</span>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {(features.length ? features : plan.modules.map((m) => MODULE_LABELS[m] ?? m)).map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => subscribe(cycle)}
              disabled={!plan.available || busy}
              className="w-full py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {checkout.phase === 'starting' && <Loader2 className="w-4 h-4 animate-spin" />}
              {plan.available ? 'Subscribe now' : 'Coming soon'}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            Pricing is unavailable right now — please try again shortly.
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-10">
          Payments are processed securely by Razorpay. Cancel anytime from your dashboard billing page.
        </p>
      </div>
    </div>
  );
}
