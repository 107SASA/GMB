'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Lock, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { usePublicPlan, MODULE_LABELS } from '@/components/billing/useRazorpayCheckout';
import {
  DurationPicker,
  pickDuration,
  getPreferredCycle,
  setPreferredCycle,
  computeSavings,
  LAUNCH_WINDOW_SECONDS,
  formatCountdown,
} from '@/components/billing/DurationPicker';

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
  /** Follows the viewport as the report scrolls (default, matches every
   *  other caller). Set false to keep it in normal document flow instead —
   *  scrolls away with the page like everything else, doesn't track the
   *  viewport. Free-report specific: per an explicit ask (Aug 2026) not to
   *  have the pricing card chase the visitor down the page. */
  sticky = true,
  /** Bundles three free-report-specific presentation choices decided
   *  together (Aug 2026): a cosmetic "Launch price" countdown badge (same
   *  pattern as /checkout — real price underneath, no fabricated numbers),
   *  the real price shown inline in the button text, and a plain-text
   *  payment-methods line at the point of purchase. Off by default so
   *  existing (dashboard) callers keep their current plain presentation. */
  promoStyle = false,
}: {
  generating?: boolean;
  unlockHeadline?: string;
  showComparison?: boolean;
  sticky?: boolean;
  promoStyle?: boolean;
}) {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState(() => getPreferredCycle() ?? 'monthly');

  // Resets every visit — no real fixed deadline exists in the billing
  // config to count down to. See the LAUNCH_WINDOW_SECONDS comment.
  const [secondsLeft, setSecondsLeft] = useState(LAUNCH_WINDOW_SECONDS);
  useEffect(() => {
    if (!promoStyle) return;
    const t = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [promoStyle]);

  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? 'month';
  const savings = computeSavings(plan?.durations, selected);
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <aside className={`${sticky ? 'lg:sticky lg:top-6' : ''} w-full lg:w-[340px] shrink-0`}>
      <div className="rounded-xl border-2 border-primary bg-surface-container-lowest card-shadow overflow-hidden">
        {promoStyle ? (
          <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-primary to-primary-container px-5 py-3 text-white text-xs font-bold uppercase tracking-widest">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Launch price
            </span>
            <span className="tabular-nums normal-case font-semibold">Ends in {formatCountdown(secondsLeft)}</span>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-primary to-primary-container px-5 py-3 text-white">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
              <Sparkles className="h-3.5 w-3.5" />
              Unlock everything
            </div>
          </div>
        )}

        <div className="p-5">
          <p className="text-sm text-on-surface-variant mb-4">
            {unlockHeadline ??
              (generating
                ? 'Your free report is generating. Here is what you get when you upgrade:'
                : 'Your report is free to keep. Upgrade to act on it — and unlock the full platform.')}
          </p>

          {plan && plan.durations?.length > 1 && (
            <DurationPicker
              durations={plan.durations}
              value={cycle}
              onChange={(c) => { setCycle(c); setPreferredCycle(c); }}
            />
          )}

          <div className="mb-5">
            {loading ? (
              <span className="inline-block h-9 w-32 animate-pulse rounded bg-surface-container-high" />
            ) : plan && price != null ? (
              <>
                <div className="text-3xl font-extrabold tracking-tight text-on-surface">
                  ₹{price.toLocaleString('en-IN')}
                  <span className="text-base font-medium text-on-surface-variant"> / {cycleLabel}</span>
                </div>
                <div className="mt-1 text-sm font-bold text-on-surface">{plan.displayName}</div>
                {savings != null && (
                  <div className="mt-1 text-xs font-bold text-secondary">You save ₹{savings.toLocaleString('en-IN')} vs paying monthly</div>
                )}
              </>
            ) : (
              <div className="text-sm text-on-surface-variant">Pricing unavailable right now.</div>
            )}
          </div>

          <ul className="space-y-2.5 mb-6">
            {(features.length ? features : Object.values(MODULE_LABELS)).map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-on-surface">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>

          {showComparison && (
            <div className="mb-6 rounded-xl border border-outline-variant bg-surface p-4">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                How this compares
              </div>
              <ul className="space-y-2.5">
                {COMPARISON_ROWS.map((row) => (
                  <li key={row.label} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-on-surface">{row.label}</span>
                    <span className="text-outline">{row.note}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between border-t border-outline-variant pt-2.5 text-xs">
                  <span className="font-bold text-primary">GrowwMatics AI</span>
                  <span className="font-bold text-primary">
                    {price != null ? `₹${price.toLocaleString('en-IN')} / ${cycleLabel}` : 'See price above'}
                  </span>
                </li>
              </ul>
            </div>
          )}

          <button
            onClick={() => { setPreferredCycle(cycle); router.push(`/checkout?cycle=${cycle}`); }}
            disabled={!plan?.available}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-bold text-white transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Lock className="h-4 w-4" />
            {promoStyle && price != null ? `Pay ₹${price.toLocaleString('en-IN')} · Start today` : 'Unlock full dashboard'}
          </button>

          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-outline">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure payment via Razorpay · Cancel anytime
          </div>
          {promoStyle && (
            <div className="mt-2 text-center text-[11px] text-outline">
              Pay via UPI · Cards · Netbanking · Wallets
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
