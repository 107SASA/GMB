import React, { useEffect, useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

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
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant">
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="layers" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">What you get</h2>
        <p className="text-on-surface-variant mb-8">
          One plan, everything included. No tiers, no add-ons.
        </p>

        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-6">
          <div className="flex items-baseline justify-between gap-4 mb-1">
            <div className="font-bold text-lg text-on-surface">
              {plan?.displayName ?? 'GrowwMatics AI'}
            </div>
            <div className="text-right">
              {plan ? (
                <>
                  <span className="text-2xl font-extrabold tracking-tight text-on-surface">
                    ₹{plan.priceInr.toLocaleString('en-IN')}
                  </span>
                  <span className="text-sm font-medium text-on-surface-variant"> /month</span>
                </>
              ) : (
                <span className="inline-block h-7 w-24 animate-pulse rounded bg-surface-container-high" />
              )}
            </div>
          </div>

          <p className="text-xs text-on-surface-variant mb-5">
            {plan?.description ?? 'Everything included, on web and mobile.'}
          </p>

          <ul className="space-y-2.5">
            {INCLUDED_MODULES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-on-surface">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <MaterialIcon name="check" size={10} className="text-on-secondary" />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-xs text-outline">
          You can finish setting up now and subscribe later from your dashboard.
        </p>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-outline-variant mt-auto">
        <button onClick={onBack} className="text-on-surface-variant font-bold hover:text-on-surface transition-colors px-4 py-2">
          Back
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all"
        >
          Review &amp; Build <MaterialIcon name="arrow_forward" size={16} />
        </button>
      </div>
    </div>
  );
}
