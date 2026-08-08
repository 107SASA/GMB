"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { getPreferredCycle, setPreferredCycle } from "@/components/billing/DurationPicker";

/**
 * The ONE plan, priced live from /api/billing/plans (super-admin editable —
 * price, features AND billing durations all come from the API).
 */
const FALLBACK_FEATURES = [
  "Google Ranking Agent — GBP optimization & audits",
  "Reputation Agent — reviews & AI replies",
  "Content Studio — AI posts & SEO content",
  "Marketing Automation — campaigns & CRM",
  "Full access on web and mobile app",
];

interface PlanDuration { cycle: string; label: string; months: number; priceInr: number; }
interface PublicPlanData {
  displayName: string;
  description: string;
  priceInr: number;
  features?: string[];
  durations?: PlanDuration[];
}

export function PricingCards() {
  const [plan, setPlan] = useState<PublicPlanData | null>(null);
  const [cycle, setCycle] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/plans")
      .then((r) => r.json())
      .then((json) => {
        const p: PublicPlanData | null = json.plan ?? json.plans?.[0] ?? null;
        setPlan(p);
        const preferred = getPreferredCycle();
        const initial = p?.durations?.find((d) => d.cycle === preferred)?.cycle
          ?? p?.durations?.find((d) => d.cycle === "monthly")?.cycle
          ?? p?.durations?.[0]?.cycle
          ?? null;
        setCycle(initial);
      })
      .catch(() => setPlan(null));
  }, []);

  const features = plan?.features?.length ? plan.features : FALLBACK_FEATURES;
  const durations = plan?.durations ?? [];
  const selected = durations.find((d) => d.cycle === cycle) ?? durations.find((d) => d.cycle === "monthly");
  const headlinePrice = selected?.priceInr ?? plan?.priceInr;
  const billedLabel = selected && selected.cycle !== "monthly" ? `Billed ${selected.label.toLowerCase()}` : null;

  return (
    <div className="w-full max-w-lg mx-auto px-4 md:px-6 z-10 relative">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true }}
        whileHover={{ scale: 1.02 }}
        className="relative flex flex-col w-full min-w-0 p-8 rounded-xl bg-surface-container-lowest border border-outline-variant card-shadow hover:border-primary/40 transition-all duration-300"
      >
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-lg uppercase tracking-widest card-shadow whitespace-nowrap">
          Everything Included
        </div>

        <div className="mb-6 flex-grow-0">
          <h3 className="text-[10px] font-bold text-primary mb-2 uppercase tracking-widest">One Simple Plan</h3>
          <h4 className="font-heading text-xl font-bold text-on-surface mb-2">
            {plan?.displayName ?? "GrowwMatics AI"}
          </h4>
          {durations.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {durations.map((d) => (
                <button
                  key={d.cycle}
                  type="button"
                  onClick={() => { setCycle(d.cycle); setPreferredCycle(d.cycle); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    d.cycle === selected?.cycle
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-baseline gap-1 mb-1 text-on-surface">
            {plan && headlinePrice != null ? (
              <span className="font-heading text-4xl font-extrabold tracking-tight">
                ₹{headlinePrice.toLocaleString("en-IN")}
              </span>
            ) : (
              <span className="inline-block w-28 h-10 bg-surface-container rounded-lg animate-pulse" />
            )}
            {(!selected || selected.cycle === "monthly") && (
              <span className="text-on-surface-variant text-sm font-medium">/month</span>
            )}
          </div>
          {billedLabel && <p className="text-xs text-outline mb-2">{billedLabel}</p>}
          <p className="text-on-surface-variant text-sm">
            {plan?.description ?? "Every feature unlocked — website and mobile app."}
          </p>
        </div>

        <div className="flex-grow">
          <ul className="space-y-4 mb-8">
            {features.map((feature, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-on-surface font-medium">
                <div className="mt-0.5 rounded-lg bg-primary-fixed p-1 flex items-center justify-center">
                  <MaterialIcon name="check" size={14} className="text-primary" />
                </div>
                <span className="leading-tight">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto pt-6 border-t border-outline-variant flex-grow-0">
          <Link href="/onboarding" className="block w-full">
            <button className="w-full py-4 rounded-lg font-bold transition-all bg-primary text-on-primary hover:bg-primary-container card-shadow">
              Start With a Free Audit
            </button>
          </Link>
          <p className="text-center text-xs text-outline mt-3">
            Run a free audit first — subscribe when you see the results.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
