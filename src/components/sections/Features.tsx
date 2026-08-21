"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const FEATURED = {
  title: "AI GMB Audit Engine",
  description:
    "Instant analysis of your Google Business Profile with actionable, prioritized optimization steps — the same audit engine that powers every other feature below.",
  icon: "search",
};

const FEATURED_BARS = [45, 65, 55, 80, 70, 92, 100];

const features = [
  {
    title: "AI SEO Content Generator",
    description: "Generate hyper-local posts and updates that rank higher on Google Maps.",
    icon: "edit",
  },
  {
    title: "7-Day Auto Scheduler",
    description: "Set it and forget it. AI handles your content calendar across all locations.",
    icon: "calendar_month",
  },
  {
    title: "Review Reply Automation",
    description: "Intelligent, personalized responses to reviews within minutes.",
    icon: "chat",
  },
  {
    title: "Built-in CRM Pipeline",
    description: "Track every lead from initial contact to final conversion in one simple view.",
    icon: "group",
  },
  {
    title: "Review Request Campaigns",
    description: "Automated WhatsApp reminders to get more 5-star reviews from happy customers.",
    icon: "mail",
  },
  {
    title: "Analytics Dashboard",
    description: "Real-time visibility into your local growth, calls, and conversions.",
    icon: "bar_chart",
  },
];

function IconBadge({ icon, size = "md" }: { icon: string; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "w-14 h-14" : "w-12 h-12";
  const iconSize = size === "lg" ? 28 : 22;
  return (
    <div
      className={`${dims} rounded-xl bg-[#e8f8ee] border border-[#c8ebd4] flex items-center justify-center shrink-0`}
    >
      <MaterialIcon name={icon} size={iconSize} className="text-[#006e2c]" />
    </div>
  );
}

export function Features() {
  return (
    <section id="product-features" className="py-20 md:py-24 px-6 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#006e2c] mb-3">Features</p>
        <h2 className="font-heading text-3xl md:text-5xl font-bold text-[#181c1c] tracking-tight mb-4">
          Everything You Need to{" "}
          <span className="text-[#006e2c]">Dominate Local Search</span>
        </h2>
        <p className="text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
          Our AI engine handles the heavy lifting, so you can focus on running your business.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="grid grid-cols-1 md:grid-cols-5 gap-8 items-center p-8 md:p-10 rounded-2xl bg-white shadow-sm border border-[#e0e3e1] mb-6"
      >
        <div className="md:col-span-3">
          <IconBadge icon={FEATURED.icon} size="lg" />
          <h3 className="font-heading text-2xl font-bold text-[#181c1c] mt-6 mb-3">{FEATURED.title}</h3>
          <p className="text-[#3d4a3d] leading-relaxed">{FEATURED.description}</p>
        </div>
        <div className="md:col-span-2 h-32 flex items-end gap-2">
          {FEATURED_BARS.map((h, i) => (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              whileInView={{ height: `${h}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.08, ease: "easeOut" }}
              className="flex-1 rounded-t-sm bg-linear-to-t from-[#006e2c] to-[#06b34c]"
            />
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((feature, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: idx * 0.08 }}
            viewport={{ once: true }}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            className="group p-8 rounded-2xl bg-white shadow-sm border border-[#e0e3e1] hover:border-[#06b34c]/40 transition-colors"
          >
            <IconBadge icon={feature.icon} />
            <h3 className="font-heading text-xl font-bold text-[#181c1c] mt-6 mb-3 group-hover:text-[#006e2c] transition-colors">
              {feature.title}
            </h3>
            <p className="text-[#3d4a3d] text-sm leading-relaxed">{feature.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
