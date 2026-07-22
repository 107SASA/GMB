'use client';

import { useRouter } from 'next/navigation';
import { Check, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import {
  usePublicPlan,
  useRazorpayCheckout,
  MODULE_LABELS,
} from '@/components/billing/useRazorpayCheckout';

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
}: {
  generating?: boolean;
}) {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const { checkout, subscribe } = useRazorpayCheckout({
    onUnauthenticated: () => router.push('/login'),
    // Gate is lifted by the webhook; refresh so the proxy stops redirecting.
    onActivated: () => {
      router.push('/dashboard');
      router.refresh();
    },
  });

  const busy = checkout.phase === 'starting' || checkout.phase === 'confirming';

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
            {generating
              ? 'Your free report is generating. Here is what you get when you upgrade:'
              : 'Your report is free to keep. Upgrade to act on it — and unlock the full platform.'}
          </p>

          <div className="mb-5">
            {loading ? (
              <span className="inline-block h-9 w-32 animate-pulse rounded bg-slate-200" />
            ) : plan ? (
              <>
                <div className="text-3xl font-extrabold tracking-tight text-slate-900">
                  ₹{plan.priceInr.toLocaleString('en-IN')}
                  <span className="text-base font-medium text-slate-500"> /month</span>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{plan.displayName}</div>
              </>
            ) : (
              <div className="text-sm text-slate-500">Pricing unavailable right now.</div>
            )}
          </div>

          <ul className="space-y-2.5 mb-6">
            {(plan?.modules?.length ? plan.modules : Object.keys(MODULE_LABELS)).map((m) => (
              <li key={m} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                {MODULE_LABELS[m] ?? m}
              </li>
            ))}
          </ul>

          {checkout.phase === 'error' && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700"
            >
              {checkout.message}
            </div>
          )}

          <button
            onClick={subscribe}
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
