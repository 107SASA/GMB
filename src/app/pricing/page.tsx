'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CatalogPlan {
  planType: 'Pro' | 'Enterprise';
  displayName: string;
  description: string;
  priceInr: number;
  billingCycle: string;
  modules: string[];
  available: boolean;
}

const MODULE_LABELS: Record<string, string> = {
  google_ranking_agent: 'Google Ranking Agent',
  reputation_agent: 'Reputation Agent',
  sales_agent: 'AI Sales Agent',
  content_studio: 'Content Studio',
  marketing_automation: 'Marketing Automation',
};

type CheckoutState =
  | { phase: 'idle' }
  | { phase: 'starting'; planType: string }
  | { phase: 'confirming' } // payment done, waiting for the webhook to flip the plan
  | { phase: 'success'; planType: string }
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

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState<CheckoutState>({ phase: 'idle' });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((json) => setPlans(json.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  // After the widget reports payment, entitlements are granted by the
  // webhook — poll /api/billing/status until it lands (or time out).
  const confirmActivation = useCallback((planType: string, attempt = 0) => {
    if (attempt > 20) {
      setCheckout({
        phase: 'error',
        message:
          "Payment received, but activation is taking longer than expected. Your plan will update automatically in a few minutes.",
      });
      return;
    }
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/billing/status');
        const json = await res.json();
        if (json?.subscription?.billingStatus === 'Active' && json.subscription.planType === planType) {
          setCheckout({ phase: 'success', planType });
          return;
        }
      } catch {
        // keep polling
      }
      confirmActivation(planType, attempt + 1);
    }, 1500);
  }, []);

  async function subscribe(plan: CatalogPlan) {
    setCheckout({ phase: 'starting', planType: plan.planType });
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType: plan.planType }),
      });
      if (res.status === 401) {
        router.push('/login');
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
          confirmActivation(plan.planType);
        },
        modal: {
          ondismiss: () => setCheckout({ phase: 'idle' }),
        },
      });
      rzp.open();
    } catch {
      setCheckout({ phase: 'error', message: 'Network error — please try again.' });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Simple pricing</h1>
          <p className="text-slate-500 mt-3 text-lg">
            Subscribe on the web. Use GMB Boost everywhere — dashboard and mobile app.
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
              You're on the {checkout.planType} plan! All included modules are now unlocked.
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
          <div className="grid md:grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-8 animate-pulse h-96" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {plans.map((plan) => {
              const highlighted = plan.planType === 'Enterprise';
              const busy = checkout.phase === 'starting' && checkout.planType === plan.planType;
              return (
                <div
                  key={plan.planType}
                  className={cn(
                    'bg-white rounded-2xl border p-8 shadow-sm flex flex-col',
                    highlighted ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-xl font-bold text-slate-900">{plan.displayName}</h2>
                    {highlighted && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                        <Sparkles className="w-3 h-3" /> Full suite
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mb-6">{plan.description}</p>
                  <div className="mb-6">
                    <span className="text-4xl font-bold text-slate-900">
                      ₹{plan.priceInr.toLocaleString('en-IN')}
                    </span>
                    <span className="text-slate-400 text-sm"> / {plan.billingCycle}</span>
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.modules.map((m) => (
                      <li key={m} className="flex items-center gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        {MODULE_LABELS[m] ?? m}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => subscribe(plan)}
                    disabled={!plan.available || busy || checkout.phase === 'confirming'}
                    className={cn(
                      'w-full py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2',
                      highlighted
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'bg-slate-900 text-white hover:bg-slate-800',
                      (!plan.available || busy) && 'opacity-60 cursor-not-allowed'
                    )}
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    {plan.available ? `Subscribe to ${plan.displayName}` : 'Coming soon'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-10">
          Payments are processed securely by Razorpay. Cancel anytime from your dashboard billing page.
        </p>
      </div>
    </div>
  );
}
