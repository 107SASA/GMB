"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const steps = [
  {
    title: "Connect Your Business",
    description: "Securely link your Google Business Profile in one click.",
    icon: "link",
  },
  {
    title: "AI Audits & Optimizes",
    description: "Our AI scans your profile and applies missing SEO optimizations.",
    icon: "memory",
  },
  {
    title: "Automate Content & Reviews",
    description: "AI starts posting updates and replying to customers automatically.",
    icon: "bolt",
  },
  {
    title: "Convert Leads in Your CRM",
    description: "Track every enquiry from first contact to conversion in one simple pipeline.",
    icon: "trending_up",
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 px-6 relative overflow-hidden bg-surface-container-lowest">
      {/* Connector Line (Desktop) */}
      <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-outline-variant to-transparent hidden lg:block -translate-y-12" />

      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6">How It Works</h2>
          <p className="text-on-surface-variant max-w-2xl mx-auto text-lg">
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
              <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-surface-container-lowest border border-outline-variant card-shadow flex items-center justify-center text-xs font-bold text-outline">
                0{idx + 1}
              </div>

              <div className="w-20 h-20 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center mb-8 group-hover:bg-primary-fixed group-hover:scale-110 transition-all duration-300 card-shadow">
                <MaterialIcon name={step.icon} size={32} className="text-primary" />
              </div>

              <h3 className="font-heading text-xl font-bold text-on-surface mb-4">{step.title}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{step.description}</p>

              {/* Connector dots for mobile/tablet */}
              {idx < steps.length - 1 && (
                <div className="lg:hidden w-px h-12 bg-gradient-to-b from-outline-variant to-transparent my-4" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
