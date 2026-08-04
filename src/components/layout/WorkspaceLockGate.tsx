'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import {
  usePublicPlan,
  useRazorpayCheckout,
  MODULE_LABELS,
  WORKSPACE_UNLOCKED_EVENT,
} from '@/components/billing/useRazorpayCheckout';
import { DurationPicker, pickDuration } from '@/components/billing/DurationPicker';

/**
 * Client-side lock for unsubscribed workspaces.
 *
 * A locked workspace can still open every dashboard tab (the proxy no longer
 * redirects), but non-free tabs render BLURRED with an upgrade overlay so the
 * owner can see what each feature looks like before paying. Real data is never
 * exposed — the gated API routes still enforce requireModule() server-side.
 *
 * Free (never blurred) pages: the free audit hook, billing/upgrade to subscribe,
 * profile, and the post-payment intake.
 */
const FREE_PREFIXES = [
  '/dashboard/audit',
  '/dashboard/billing',
  '/dashboard/upgrade',
  '/dashboard/profile',
  '/dashboard/onboarding',
];

function isFreePage(pathname: string): boolean {
  return FREE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function WorkspaceLockGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [locked, setLocked] = useState<boolean | null>(null);

  // Re-check on navigation so the gate lifts immediately after subscribing.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setLocked(!!j?.workspace && !j.workspace.isActive); })
      .catch(() => { if (!cancelled) setLocked(false); });
    return () => { cancelled = true; };
  }, [pathname]);

  // Checkout can be started from the very page the user stays on after
  // paying (e.g. the dashboard home itself) — the pathname never changes, so
  // the effect above never re-fires. Drop the lock the instant the webhook
  // confirms activation, regardless of route.
  useEffect(() => {
    const onUnlocked = () => setLocked(false);
    window.addEventListener(WORKSPACE_UNLOCKED_EVENT, onUnlocked);
    return () => window.removeEventListener(WORKSPACE_UNLOCKED_EVENT, onUnlocked);
  }, []);

  // Still checking, unlocked, or on a free page → render normally (never flash a
  // blur at a paying customer).
  if (locked !== true || isFreePage(pathname)) return <>{children}</>;

  return (
    <div className="relative min-h-[70vh]">
      <div className="pointer-events-none select-none blur-[6px] opacity-60" aria-hidden>
        {children}
      </div>
      <LockOverlay />
    </div>
  );
}

function LockOverlay() {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState('monthly');
  const { checkout, subscribe } = useRazorpayCheckout({
    onUnauthenticated: () => router.push('/login'),
    onActivated: () => { router.push('/dashboard'); router.refresh(); },
  });
  const busy = checkout.phase === 'starting' || checkout.phase === 'confirming';
  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? 'month';
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center px-4 pt-8 sm:pt-14">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-primary bg-surface-container-lowest card-shadow card-shadow">
        <div className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary-container px-5 py-3 text-xs font-bold uppercase tracking-widest text-white">
          <Lock className="h-3.5 w-3.5" /> Locked — upgrade to unlock
        </div>

        <div className="p-6">
          <div className="mb-1 flex items-center gap-1.5 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-semibold">This is a paid feature</span>
          </div>
          <p className="mb-5 text-sm text-on-surface-variant">
            You&apos;re seeing a preview of this tab. Unlock the full dashboard to use it with your real data.
          </p>

          {plan && plan.durations?.length > 1 && (
            <DurationPicker durations={plan.durations} value={cycle} onChange={setCycle} />
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
              </>
            ) : (
              <div className="text-sm text-on-surface-variant">Pricing unavailable right now.</div>
            )}
          </div>

          <ul className="mb-6 space-y-2.5">
            {(features.length ? features : Object.values(MODULE_LABELS)).map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-on-surface">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>

          {checkout.phase === 'error' && (
            <div role="alert" className="mb-4 rounded-xl border border-error-container bg-error-container p-3 text-sm font-medium text-on-error-container">
              {checkout.message}
            </div>
          )}

          <button
            onClick={() => subscribe(cycle)}
            disabled={busy || !plan?.available}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3.5 font-bold text-on-primary transition-all hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkout.phase === 'starting' && (<><Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…</>)}
            {checkout.phase === 'confirming' && (<><Loader2 className="h-4 w-4 animate-spin" /> Activating…</>)}
            {checkout.phase === 'success' && (<><Check className="h-4 w-4" /> Activated</>)}
            {(checkout.phase === 'idle' || checkout.phase === 'error') && (<><Lock className="h-4 w-4" /> Unlock full dashboard</>)}
          </button>

          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-outline">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure payment via Razorpay · Cancel anytime
          </div>
        </div>
      </div>
    </div>
  );
}
