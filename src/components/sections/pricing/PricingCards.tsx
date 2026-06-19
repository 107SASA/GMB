"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Link from "next/link";

const plans = [
  {
    name: "GBP STARTER",
    outcome: "Build Visibility",
    price: "₹999",
    description: "Best for new businesses",
    features: [
      "1 Business Profile",
      "Monthly Audit Report",
      "7 AI GBP Posts / Month",
      "Review Monitoring",
      "Basic SEO Recommendations",
      "Competitor Overview",
      "Audit History"
    ],
    limits: ["7 Posts", "1 Audit / Month", "1 Business"],
    cta: "Get Started",
    href: "/signup",
    popular: false
  },
  {
    name: "LOCAL GROWTH",
    outcome: "Generate Leads",
    price: "₹2499",
    description: "Most Popular",
    features: [
      "Everything in Starter",
      "15 AI Posts / Month",
      "Weekly Audit Reports",
      "Review Management",
      "AI Review Replies",
      "Local Competitor Tracking",
      "Keyword Tracking",
      "CRM",
      "Lead Tracking"
    ],
    limits: ["15 Posts", "4 Audits / Month", "1 Business"],
    cta: "Start Growing",
    href: "/signup",
    popular: true
  },
  {
    name: "LEAD CONVERSION PRO",
    outcome: "Convert Customers",
    price: "₹4999",
    description: "Designed for serious growth",
    features: [
      "Everything in Growth",
      "30 AI Posts / Month",
      "Unlimited Reviews",
      "WhatsApp AI Agent",
      "Automated Follow-ups",
      "Lead Qualification",
      "Conversion Tracking",
      "Advanced Audit Intelligence",
      "Priority Support"
    ],
    limits: ["30 Posts", "Unlimited Audits", "1 Business"],
    cta: "Upgrade To Pro",
    href: "/signup",
    popular: false
  },
  {
    name: "AGENCY / MULTI-LOCATION",
    outcome: "Scale Multiple Businesses",
    price: "₹9999",
    description: "For agencies and enterprises",
    features: [
      "Everything in Pro",
      "Multiple Businesses",
      "Multi-Location Support",
      "White Label Reports",
      "Team Members",
      "API Access",
      "Advanced Analytics",
      "Custom Branding",
      "Dedicated Success Manager"
    ],
    limits: ["Unlimited"],
    cta: "Contact Sales",
    href: "/book-demo",
    popular: false
  }
];

export function PricingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-7xl mx-auto px-4 md:px-6 z-10 relative">
      {plans.map((plan, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: idx * 0.1 }}
          viewport={{ once: true }}
          whileHover={{ scale: 1.02 }}
          className={`relative flex flex-col p-8 rounded-[24px] bg-white transition-all duration-300 ${
            plan.popular 
              ? "border-2 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)] hover:shadow-[0_0_40px_rgba(99,102,241,0.4)] md:-translate-y-4 md:hover:-translate-y-6 xl:scale-105 xl:hover:scale-[1.07] z-20" 
              : "border border-slate-200 shadow-xl shadow-slate-200/50 hover:shadow-2xl hover:shadow-indigo-500/10 z-10"
          }`}
        >
          {plan.popular && (
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold rounded-full uppercase tracking-widest shadow-lg shadow-indigo-500/30 whitespace-nowrap">
              Most Popular
            </div>
          )}
          
          <div className="mb-6 flex-grow-0">
            <h3 className="text-[10px] font-bold text-indigo-600 mb-2 uppercase tracking-widest">{plan.outcome}</h3>
            <h4 className="text-xl font-bold text-slate-900 mb-2">{plan.name}</h4>
            <div className="flex items-baseline gap-1 mb-2 text-slate-900">
              <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
              <span className="text-slate-500 text-sm font-medium">/month</span>
            </div>
            <p className="text-slate-500 text-sm">{plan.description}</p>
          </div>

          <div className="flex-grow">
            <ul className="space-y-4 mb-8">
              {plan.features.map((feature, i) => (
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
            <div className="mb-6 space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Plan Limits</p>
              {plan.limits.map((limit, i) => (
                <div key={i} className="flex items-center text-xs text-slate-500 font-medium bg-slate-50 rounded-md px-3 py-2">
                  {limit}
                </div>
              ))}
            </div>

            <Link href={plan.href} className="block w-full">
              <button className={`w-full py-4 rounded-xl font-bold transition-all ${
                plan.popular 
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 shadow-lg shadow-indigo-500/30" 
                  : "bg-slate-50 text-slate-900 hover:bg-slate-100 border border-slate-200"
              }`}>
                {plan.cta}
              </button>
            </Link>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
