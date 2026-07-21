'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reusable Razorpay checkout for THE plan (there is only one). Used by the
 * /pricing page and meant to be dropped into the audit-report "unlock all
 * features" panel:
 *
 *   const { checkout, subscribe, reset } = useRazorpayCheckout({
 *     onUnauthenticated: () => router.push('/login'),
 *   });
 *   <button onClick={subscribe}>Subscribe</button>
 *
 * Flow: POST /api/billing/checkout (auth required — the visitor must have an
 * account before paying) → open the Razorpay widget → after payment, poll
 * /api/billing/status until the webhook activates the plan (phase
 * 'success'). Entitlements are only ever granted by the webhook.
 */

export interface PublicPlan {
  planType: string;
  displayName: string;
  description: string;
  priceInr: number;
  billingCycle: string;
  modules: string[];
  available: boolean;
}

export const MODULE_LABELS: Record<string, string> = {
  google_ranking_agent: 'Google Ranking Agent',
  reputation_agent: 'Reputation Agent',
  sales_agent: 'AI Sales Agent',
  content_studio: 'Content Studio',
  marketing_automation: 'Marketing Automation',
};

export type CheckoutState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'confirming' } // payment done, waiting for the webhook to flip the plan
  | { phase: 'success' }
  | { phase: 'error'; message: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/** Fetches the single sellable plan for display (price, name, modules). */
export function usePublicPlan() {
  const [plan, setPlan] = useState<PublicPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((json) => setPlan(json.plan ?? json.plans?.[0] ?? null))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, []);

  return { plan, loading };
}

export function useRazorpayCheckout(opts?: {
  onUnauthenticated?: () => void;
  /** Called once the webhook has activated the plan. */
  onActivated?: () => void;
}) {
  const [checkout, setCheckout] = useState<CheckoutState>({ phase: 'idle' });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  // After the widget reports payment, entitlements are granted by the
  // webhook — poll /api/billing/status until it lands (or time out).
  const confirmActivation = useCallback((attempt = 0) => {
    if (attempt > 20) {
      setCheckout({
        phase: 'error',
        message:
          'Payment received, but activation is taking longer than expected. Your plan will update automatically in a few minutes.',
      });
      return;
    }
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/billing/status');
        const json = await res.json();
        if (json?.subscription?.billingStatus === 'Active') {
          setCheckout({ phase: 'success' });
          optsRef.current?.onActivated?.();
          return;
        }
      } catch {
        // keep polling
      }
      confirmActivation(attempt + 1);
    }, 1500);
  }, []);

  const subscribe = useCallback(async () => {
    setCheckout({ phase: 'starting' });
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      if (res.status === 401) {
        setCheckout({ phase: 'idle' });
        optsRef.current?.onUnauthenticated?.();
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.success) {
        setCheckout({ phase: 'error', message: json.error || 'Could not start checkout.' });
        return;
      }

      if (!(await loadRazorpayScript()) || !window.Razorpay) {
        setCheckout({ phase: 'error', message: 'Could not load the payment widget. Check your connection.' });
        return;
      }

      const rzp = new window.Razorpay({
        key: json.checkout.key,
        subscription_id: json.checkout.subscriptionId,
        name: json.checkout.name,
        description: json.checkout.description,
        prefill: json.checkout.prefill,
        theme: { color: '#4f46e5' },
        handler: () => {
          setCheckout({ phase: 'confirming' });
          confirmActivation();
        },
        modal: {
          ondismiss: () => setCheckout({ phase: 'idle' }),
        },
      });
      rzp.open();
    } catch {
      setCheckout({ phase: 'error', message: 'Network error — please try again.' });
    }
  }, [confirmActivation]);

  const reset = useCallback(() => setCheckout({ phase: 'idle' }), []);

  return { checkout, subscribe, reset };
}
