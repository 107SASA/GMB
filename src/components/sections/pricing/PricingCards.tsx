"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Link from "next/link";

/**
 * The ONE plan, priced live from /api/billing/plans (super-admin editable).
 * Marketing bullets stay hardcoded here; the price never should be.
 */
const FEATURES = [
  "Google Ranking Agent — GBP optimization & audits",
  "Reputation Agent — reviews & AI replies",
  "Content Studio — AI posts & SEO content",
  "Marketing Automation — campaigns & CRM",
  "Full access on web and mobile app",
];

export function PricingCards() {
  const [plan, setPlan] = useState<{ displayName: string; description: string; priceInr: number } | null>(null);

  useEffect(() => {
    fetch("/api/billing/plans")
      .then((r) => r.json())
      .then((json) => setPlan(json.plan ?? json.plans?.[0] ?? null))
      .catch(() => setPlan(null));
  }, []);

  return (
    <div className="max-w-lg mx-auto px-4 md:px-6 z-10 relative">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true }}
        whileHover={{ scale: 1.02 }}
        className="relative flex flex-col p-8 rounded-[24px] bg-white border-2 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)] hover:shadow-[0_0_40px_rgba(99,102,241,0.4)] transition-all duration-300"
      >
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold rounded-full uppercase tracking-widest shadow-lg shadow-indigo-500/30 whitespace-nowrap">
          Everything Included
        </div>

        <div className="mb-6 flex-grow-0">
          <h3 className="text-[10px] font-bold text-indigo-600 mb-2 uppercase tracking-widest">One Simple Plan</h3>
          <h4 className="text-xl font-bold text-slate-900 mb-2">{plan?.displayName ?? "Growwmatic AI"}</h4>
          <div className="flex items-baseline gap-1 mb-2 text-slate-900">
            {plan ? (
              <span className="text-4xl font-extrabold tracking-tight">
                ₹{plan.priceInr.toLocaleString("en-IN")}
              </span>
            ) : (
              <span className="inline-block w-28 h-10 bg-slate-100 rounded-lg animate-pulse" />
            )}
            <span className="text-slate-500 text-sm font-medium">/month</span>
          </div>
          <p className="text-slate-500 text-sm">
            {plan?.description ?? "Every feature unlocked — website and mobile app."}
          </p>
        </div>

        <div className="flex-grow">
          <ul className="space-y-4 mb-8">
            {FEATURES.map((feature, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-700 font-medium">
                <div className="mt-0.5 rounded-full bg-indigo-50 p-1">
                  <Check className="w-3 h-3 text-indigo-600 shrink-0 stroke-[3]" />
                </div>
                <span className="leading-tight">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-100 flex-grow-0">
          <Link href="/signup" className="block w-full">
            <button className="w-full py-4 rounded-xl font-bold transition-all bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 shadow-lg shadow-indigo-500/30">
              Start With a Free Audit
            </button>
          </Link>
          <p className="text-center text-xs text-slate-400 mt-3">
            Run a free audit first — subscribe when you see the results.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
