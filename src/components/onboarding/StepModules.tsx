import React, { useEffect, useState } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Layers, Check } from 'lucide-react';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * There is exactly ONE sellable plan (see src/lib/billing/planCatalog.ts).
 * This step used to show three invented USD tiers (Starter $49 / Growth $99 /
 * Enterprise $299) and promise a 14-day free trial that does not exist — real
 * signups saw pricing that matched neither the pricing page nor Razorpay.
 *
 * The price is fetched live from /api/billing/plans (the same endpoint the
 * marketing PricingCards uses) so it can never drift from what the super admin
 * has configured. Never hardcode the price here.
 */
const INCLUDED_MODULES = [
  'Google Ranking Agent — GBP optimization & audits',
  'Reputation Agent — reviews & AI replies',
  'AI Sales Agent — WhatsApp lead follow-ups',
  'Content Studio — AI posts & SEO content',
  'Marketing Automation — campaigns & CRM',
  'Full access on web and mobile app',
];

interface ActivePlan {
  displayName: string;
  description: string;
  priceInr: number;
}

export default function StepModules({ data, updateData, onNext, onBack }: Props) {
  const [plan, setPlan] = useState<ActivePlan | null>(null);

  useEffect(() => {
    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((json) => setPlan(json.plan ?? json.plans?.[0] ?? null))
      .catch(() => setPlan(null));
  }, []);

  // The single plan is implicit — record it so downstream steps stay unchanged.
  useEffect(() => {
    if (!data.selectedPlan) updateData({ selectedPlan: 'pro' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.selectedPlan]);

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
        <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center mb-6">
          <Layers className="text-purple-600 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">What you get</h2>
        <p className="text-slate-500 mb-8">
          One plan, everything included. No tiers, no add-ons.
        </p>

        <div className="rounded-2xl border-2 border-slate-900 bg-slate-50 p-6">
          <div className="flex items-baseline justify-between gap-4 mb-1">
            <div className="font-bold text-lg text-slate-900">
              {plan?.displayName ?? 'Growwmatic AI'}
            </div>
            <div className="text-right">
              {plan ? (
                <>
                  <span className="text-2xl font-extrabold tracking-tight text-slate-900">
                    ₹{plan.priceInr.toLocaleString('en-IN')}
                  </span>
                  <span className="text-sm font-medium text-slate-500"> /month</span>
                </>
              ) : (
                <span className="inline-block h-7 w-24 animate-pulse rounded bg-slate-200" />
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500 mb-5">
            {plan?.description ?? 'Everything included, on web and mobile.'}
          </p>

          <ul className="space-y-2.5">
            {INCLUDED_MODULES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-xs text-slate-400">
          You can finish setting up now and subscribe later from your dashboard.
        </p>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-slate-100 mt-auto">
        <button onClick={onBack} className="text-slate-500 font-bold hover:text-slate-900 transition-colors px-4 py-2">
          Back
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md"
        >
          Review &amp; Build <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
