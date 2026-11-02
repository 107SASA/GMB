'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import {
  MODULE_LABELS,
  usePublicPlan,
} from '@/components/billing/useRazorpayCheckout';
import { DurationPicker, pickDuration, getPreferredCycle, setPreferredCycle } from '@/components/billing/DurationPicker';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BookDemoButton } from '@/components/shared/BookDemoButton';
import { BRAND_ATTRIBUTION } from '@/lib/companyInfo';

const TRUST_POINTS = [
  'One plan, no tiers to compare',
  'Includes both the web dashboard and mobile app',
  'Cancel anytime from your dashboard',
  'Setup in one call — no technical work on your end',
] as const;

/**
 * GrowwMatics' regular list price per billing cycle (set Nov 2026). While the
 * live price from the billing plan is lower, the page shows this struck out
 * with a "Launch offer" label and "% OFF" badge. Keep these equal to the
 * real regular prices, and end or restate the offer rather than running it
 * indefinitely.
 */
const LIST_PRICE_INR: Record<string, number> = {
  monthly: 6999,
  yearly: 35999,
};

export default function PricingPage() {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState(() => getPreferredCycle() ?? 'yearly');

  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? plan?.billingCycle ?? 'month';
  const listPrice = LIST_PRICE_INR[selected?.cycle ?? cycle];
  const showOffer = !!price && !!listPrice && listPrice > price;
  // Rounded down so the badge never overstates the discount.
  const percentOff = showOffer ? Math.floor(((listPrice - price) / listPrice) * 100) : 0;
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <section className="relative pt-28 sm:pt-32 md:pt-40 pb-20 sm:pb-28 px-4 sm:px-6 md:px-12">
        {/* Phones: heading → plan card → trust points (the card used to come
            before the page heading). lg+: copy left, sticky card right. */}
        <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-8 lg:gap-x-16 lg:gap-y-0 items-start">
          {/* Left: heading */}
          <div className="lg:col-span-6 lg:row-start-1 lg:pt-6">
            <p className="mkt-label text-[#006e2c] mb-2">Pricing</p>
            <h1 className="font-mkt-display text-4xl sm:text-5xl font-semibold text-[#101613] tracking-tight mb-4">
              Simple pricing
            </h1>
            <p className="text-[#3d4a3d] text-base sm:text-lg leading-relaxed lg:mb-10 max-w-md">
              One plan, everything included — dashboard and mobile app. No tiers, no add-ons to
              figure out.
            </p>
          </div>

          {/* Left (lg row 2): trust points */}
          <div className="order-last lg:order-none lg:col-span-6 lg:row-start-2">
            <ul className="flex flex-col gap-4 mb-10">
              {TRUST_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <MaterialIcon name="check_circle" size={18} className="text-[#006e2c] shrink-0 mt-0.5" />
                  <span className="text-[#101613]">{point}</span>
                </li>
              ))}
            </ul>

            <div>
              <p className="text-sm text-[#3d4a3d] mb-3">Want a walkthrough first?</p>
              <BookDemoButton
                origin="pricing"
                className="px-7 py-3 rounded-lg border border-(--mkt-line) bg-white text-[#101613] font-semibold hover:border-[#006e2c] hover:text-[#006e2c] transition-colors"
              />
            </div>

            <p className="text-xs text-[#9aa59c] mt-10">
              Payments are processed securely by Razorpay. Cancel anytime from your dashboard billing page.
            </p>
            <p className="text-xs text-[#9aa59c] mt-1">{BRAND_ATTRIBUTION}</p>
          </div>

          {/* Right: the plan card */}
          <div className="lg:col-span-6 lg:col-start-7 lg:row-start-1 lg:row-span-2">
            <div className="lg:sticky lg:top-28">
              {loading ? (
                <div className="bg-white rounded-xl border border-(--mkt-line) shadow-sm p-8 animate-pulse h-96" />
              ) : plan ? (
                <div className="bg-white rounded-xl border-2 border-[#006e2c] shadow-lg p-5 sm:p-8 flex flex-col">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h2 className="font-mkt-display text-xl font-semibold text-[#101613]">{plan.displayName}</h2>
                    <span className="mkt-label flex items-center gap-1 text-[#006e2c] bg-[#e8f8ee] border border-[#c8ebd4] px-2 py-1 rounded-md">
                      <MaterialIcon name="auto_awesome" size={12} className="text-[#006e2c]" /> All features
                    </span>
                  </div>
                  <p className="text-sm text-[#3d4a3d] mb-6">{plan.description}</p>
                  {plan.durations?.length > 1 && (
                    <DurationPicker
                      durations={plan.durations}
                      value={cycle}
                      onChange={(c) => { setCycle(c); setPreferredCycle(c); }}
                    />
                  )}
                  <div className="mb-6">
                    {showOffer && (
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-bold uppercase tracking-wide text-[#b45309] bg-[#fff4e5] border border-[#fcd9a8] px-2 py-1 rounded-md">
                          Launch offer
                        </span>
                        <span className="font-mkt-mono text-lg text-[#6b7280] line-through" aria-label={`Regular price ₹${listPrice.toLocaleString('en-IN')}`}>
                          ₹{listPrice.toLocaleString('en-IN')}
                        </span>
                        <span className="text-xs font-bold text-white bg-[#f0943f] px-2 py-1 rounded-md">
                          {percentOff}% OFF
                        </span>
                      </div>
                    )}
                    <span className="font-mkt-mono text-4xl font-semibold text-[#101613]">
                      ₹{(price ?? plan.priceInr).toLocaleString('en-IN')}
                    </span>
                    <span className="text-[#3d4a3d] text-sm"> / {cycleLabel}</span>
                    {showOffer && (
                      <p className="text-xs text-[#6b7280] mt-1">
                        Regular price ₹{listPrice.toLocaleString('en-IN')} / {cycleLabel}. Launch offer for a limited period; prices include all features.
                      </p>
                    )}
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {(features.length ? features : plan.modules.map((m) => MODULE_LABELS[m] ?? m)).map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-[#101613]">
                        <MaterialIcon name="check_circle" size={16} className="text-[#006e2c] shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => { setPreferredCycle(cycle); router.push(`/checkout?cycle=${cycle}`); }}
                    disabled={!plan.available}
                    className="w-full py-3.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-[#006e2c] text-white hover:bg-[#005a24] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {plan.available ? 'Subscribe now' : 'Coming soon'}
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-(--mkt-line) shadow-sm p-8 text-center text-sm text-[#3d4a3d]">
                  Pricing is unavailable right now — please try again shortly.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
