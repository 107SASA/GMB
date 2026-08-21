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

export default function PricingPage() {
  const router = useRouter();
  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState(() => getPreferredCycle() ?? 'monthly');

  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? plan?.billingCycle ?? 'month';
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  return (
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed">
      <Navbar />

      <section className="pt-28 md:pt-32 pb-20 px-4 md:px-6">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="font-heading text-4xl md:text-5xl font-bold text-[#181c1c] tracking-tight">
              Simple pricing
            </h1>
            <p className="text-[#3d4a3d] mt-3 text-lg">
              One plan, everything included — dashboard and mobile app.
            </p>
          </div>

          {loading ? (
            <div className="bg-white rounded-2xl border border-[#e0e3e1] shadow-sm p-8 animate-pulse h-96" />
          ) : plan ? (
            <div className="bg-white rounded-2xl border-2 border-[#06b34c] shadow-lg p-8 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="font-heading text-xl font-bold text-[#181c1c]">{plan.displayName}</h2>
                <span className="flex items-center gap-1 text-[11px] font-bold text-[#006e2c] bg-[#e8f8ee] border border-[#c8ebd4] px-2 py-0.5 rounded-lg">
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
                <span className="font-heading text-4xl font-bold text-[#181c1c]">
                  ₹{(price ?? plan.priceInr).toLocaleString('en-IN')}
                </span>
                <span className="text-[#3d4a3d] text-sm"> / {cycleLabel}</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {(features.length ? features : plan.modules.map((m) => MODULE_LABELS[m] ?? m)).map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-[#181c1c]">
                    <MaterialIcon name="check_circle" size={16} className="text-[#06b34c] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => { setPreferredCycle(cycle); router.push(`/checkout?cycle=${cycle}`); }}
                disabled={!plan.available}
                className="w-full py-3.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-[#06b34c] text-white hover:bg-[#059640] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {plan.available ? 'Subscribe now' : 'Coming soon'}
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#e0e3e1] shadow-sm p-8 text-center text-sm text-[#3d4a3d]">
              Pricing is unavailable right now — please try again shortly.
            </div>
          )}

          <div className="mt-10 text-center">
            <p className="text-sm text-[#3d4a3d] mb-4">Want a walkthrough first?</p>
            <BookDemoButton
              origin="pricing"
              className="px-7 py-3 rounded-lg border-2 border-[#006e2c] text-[#006e2c] font-semibold hover:bg-white transition-colors"
            />
          </div>

          <p className="text-center text-xs text-[#9aa59c] mt-10">
            Payments are processed securely by Razorpay. Cancel anytime from your dashboard billing page.
          </p>
          <p className="text-center text-xs text-[#9aa59c] mt-1">{BRAND_ATTRIBUTION}</p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
