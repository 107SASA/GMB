"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProcessPath } from "@/components/graphics/ProcessPath";

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
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="How it works"
          title="Four Steps to Your Local Presence"
          description="No manual setup marathon — connect once and the AI takes over from there."
          className="mb-20"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 relative">
          <ProcessPath />

          {steps.map((step, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              viewport={{ once: true }}
              className="relative flex flex-col items-center text-center group"
            >
              <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-surface-container-lowest border border-outline-variant card-shadow flex items-center justify-center text-xs font-bold text-outline z-10">
                0{idx + 1}
              </div>

              <div className="w-20 h-20 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center mb-8 group-hover:bg-primary-fixed group-hover:scale-110 transition-all duration-300 card-shadow relative z-10">
                <MaterialIcon name={step.icon} size={32} className="text-primary" />
              </div>

              <h3 className="font-heading text-xl font-bold text-on-surface mb-4">{step.title}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{step.description}</p>

              {idx < steps.length - 1 && (
                <div className="lg:hidden w-px h-12 bg-linear-to-b from-outline-variant to-transparent my-4" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
