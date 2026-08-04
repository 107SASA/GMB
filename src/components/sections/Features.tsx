"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const features = [
  {
    title: "AI GMB Audit Engine",
    description: "Instant analysis of your profile with actionable AI-driven optimization steps.",
    icon: "search",
    color: "bg-primary-fixed text-primary",
  },
  {
    title: "AI SEO Content Generator",
    description: "Generate hyper-local posts and updates that rank higher on Google Maps.",
    icon: "edit",
    color: "bg-primary-fixed text-primary",
  },
  {
    title: "7-Day Auto Scheduler",
    description: "Set it and forget it. AI handles your content calendar across all locations.",
    icon: "calendar_month",
    color: "bg-secondary-container/40 text-secondary",
  },
  {
    title: "Review Reply Automation",
    description: "Intelligent, personalized responses to reviews within minutes.",
    icon: "chat",
    color: "bg-secondary-container/40 text-on-secondary-container",
  },
  {
    title: "Built-in CRM Pipeline",
    description: "Track every lead from initial contact to final conversion in one simple view.",
    icon: "group",
    color: "bg-primary-fixed text-primary",
  },
  {
    title: "Review Request Campaigns",
    description: "Automated WhatsApp reminders to get more 5-star reviews from happy customers.",
    icon: "mail",
    color: "bg-primary-fixed text-primary",
  },
  {
    title: "Analytics Dashboard",
    description: "Real-time visibility into your local growth, calls, and conversions.",
    icon: "bar_chart",
    color: "bg-primary-fixed text-primary",
  },
];

export function Features() {
  return (
    <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
      <div className="text-center mb-20">
        <h2 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6">
          Everything You Need to{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
            Dominate Local Search
          </span>
        </h2>
        <p className="text-on-surface-variant max-w-2xl mx-auto text-lg">
          Our AI engine handles the heavy lifting, so you can focus on running your business.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: idx * 0.1 }}
            viewport={{ once: true }}
            whileHover={{ y: -5, transition: { duration: 0.2 } }}
            className="group p-8 rounded-xl bg-surface-container-lowest card-shadow border border-outline-variant hover:border-primary/30 transition-all relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

            <div
              className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}
            >
              <MaterialIcon name={feature.icon} size={24} />
            </div>

            <h3 className="font-heading text-xl font-bold text-on-surface mb-3 group-hover:text-primary transition-colors">
              {feature.title}
            </h3>
            <p className="text-on-surface-variant text-sm leading-relaxed">{feature.description}</p>

            <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-primary/5 blur-[60px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
