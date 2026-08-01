'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import {
  usePublicPlan,
  useRazorpayCheckout,
  MODULE_LABELS,
} from '@/components/billing/useRazorpayCheckout';
import { DurationPicker, pickDuration } from '@/components/billing/DurationPicker';

/** Generic, non-numeric comparisons — deliberately no invented rupee figures. */
const COMPARISON_ROWS = [
  { label: 'Hiring a marketing person', note: 'Full-time salary' },
  { label: 'A local digital agency', note: 'Monthly retainer' },
  { label: 'DIY — doing it yourself', note: 'Hours of your time, every week' },
];

/**
 * The pricing card shown BESIDE a free audit report.
 *
 * Replaces the old FreeAuditUpgradeModal, which interrupted the user the moment
 * their report finished. A persistent sidebar lets them read the whole report
 * (which stays free forever — it is the lead magnet) with the offer alongside it.
 *
 * Entitlements are never granted here: `useRazorpayCheckout` opens the widget,
 * then polls /api/billing/status until the Razorpay webhook activates the plan.
 */
export default function AuditPaywallSidebar({
  /** Rendered while the report is still generating, to fill the wait. */
  generating = false,
  /** Overrides the default intro copy above the price. */
  unlockHeadline,
  /** Adds a "how this compares" block below the feature list — generic
   *  labels only, no invented competitor pricing. Off by default so the
   *  existing (dashboard) callers of this component are unaffected. */
  showComparison = false,
}: {
  generating?: boolean;
  unlockHeadline?: string;
  showComparison?: boolean;
}) {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState('monthly');
  const { checkout, subscribe } = useRazorpayCheckout({
    onUnauthenticated: () => router.push('/login'),
    // Gate is lifted by the webhook; refresh so the proxy stops redirecting.
    onActivated: () => {
      router.push('/dashboard');
      router.refresh();
    },
  });

  const busy = checkout.phase === 'starting' || checkout.phase === 'confirming';
  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? 'month';
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <aside className="lg:sticky lg:top-6 w-full lg:w-[340px] shrink-0">
      <div className="rounded-2xl border-2 border-indigo-500 bg-white shadow-lg shadow-indigo-500/10 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-3 text-white">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
            <Sparkles className="h-3.5 w-3.5" />
            Unlock everything
          </div>
        </div>

        <div className="p-5">
          <p className="text-sm text-slate-600 mb-4">
            {unlockHeadline ??
              (generating
                ? 'Your free report is generating. Here is what you get when you upgrade:'
                : 'Your report is free to keep. Upgrade to act on it — and unlock the full platform.')}
          </p>

          {plan && plan.durations?.length > 1 && (
            <DurationPicker durations={plan.durations} value={cycle} onChange={setCycle} />
          )}

          <div className="mb-5">
            {loading ? (
              <span className="inline-block h-9 w-32 animate-pulse rounded bg-slate-200" />
            ) : plan && price != null ? (
              <>
                <div className="text-3xl font-extrabold tracking-tight text-slate-900">
                  ₹{price.toLocaleString('en-IN')}
                  <span className="text-base font-medium text-slate-500"> / {cycleLabel}</span>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{plan.displayName}</div>
              </>
            ) : (
              <div className="text-sm text-slate-500">Pricing unavailable right now.</div>
            )}
          </div>

          <ul className="space-y-2.5 mb-6">
            {(features.length ? features : Object.values(MODULE_LABELS)).map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>

          {showComparison && (
            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                How this compares
              </div>
              <ul className="space-y-2.5">
                {COMPARISON_ROWS.map((row) => (
                  <li key={row.label} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    <span className="text-slate-400">{row.note}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between border-t border-slate-200 pt-2.5 text-xs">
                  <span className="font-bold text-indigo-700">GrowwMatics AI</span>
                  <span className="font-bold text-indigo-700">
                    {price != null ? `₹${price.toLocaleString('en-IN')} / ${cycleLabel}` : 'See price above'}
                  </span>
                </li>
              </ul>
            </div>
          )}

          {checkout.phase === 'error' && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700"
            >
              {checkout.message}
            </div>
          )}

          <button
            onClick={() => subscribe(cycle)}
            disabled={busy || !plan?.available}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkout.phase === 'starting' && (<><Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…</>)}
            {checkout.phase === 'confirming' && (<><Loader2 className="h-4 w-4 animate-spin" /> Activating…</>)}
            {checkout.phase === 'success' && (<><Check className="h-4 w-4" /> Activated</>)}
            {(checkout.phase === 'idle' || checkout.phase === 'error') && (<><Lock className="h-4 w-4" /> Unlock full dashboard</>)}
          </button>

          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure payment via Razorpay · Cancel anytime
          </div>
        </div>
      </div>
    </aside>
  );
}
