"use client";

import { motion } from "framer-motion";
import { Link2, Cpu, Zap, TrendingUp } from "lucide-react";

const steps = [
  {
    title: "Connect Your Business",
    description: "Securely link your Google Business Profile in one click.",
    icon: Link2,
  },
  {
    title: "AI Audits & Optimizes",
    description: "Our AI scans your profile and applies missing SEO optimizations.",
    icon: Cpu,
  },
  {
    title: "Automate Content & Reviews",
    description: "AI starts posting updates and replying to customers automatically.",
    icon: Zap,
  },
  {
    title: "Convert Leads with WhatsApp AI",
    description: "Watch as visitors turn into sales through automated chat flows.",
    icon: TrendingUp,
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 px-6 relative overflow-hidden bg-white">
      {/* Connector Line (Desktop) */}
      <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent hidden lg:block -translate-y-12" />

      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6">How It Works</h2>
          <p className="text-slate-500 max-w-2xl mx-auto text-lg">
            Four simple steps to transform your local presence.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 relative">
          {steps.map((step, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              viewport={{ once: true }}
              className="relative flex flex-col items-center text-center group"
            >
              {/* Step Number */}
              <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-xs font-bold text-slate-400">
                0{idx + 1}
              </div>

              <div className="w-20 h-20 rounded-3xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-8 group-hover:bg-indigo-100 group-hover:scale-110 transition-all duration-300 shadow-sm">
                <step.icon className="w-8 h-8 text-primary" />
              </div>

              <h3 className="text-xl font-bold text-slate-900 mb-4">{step.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{step.description}</p>
              
              {/* Connector dots for mobile/tablet */}
              {idx < steps.length - 1 && (
                <div className="lg:hidden w-px h-12 bg-gradient-to-b from-slate-200 to-transparent my-4" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
