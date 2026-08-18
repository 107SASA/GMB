"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const NEW_LEADS = [
  { name: "Local Bakery Co.", meta: "Google Maps · 2m ago", initial: "L", color: "bg-primary" },
  { name: "Riverside Dental", meta: "Website form · 14m ago", initial: "R", color: "bg-secondary" },
];

const IN_PROGRESS = {
  name: "Sunrise Auto Repair",
  meta: "WhatsApp reply sent",
  initial: "S",
};

/**
 * Replaces the old "Lead Pipeline" mock, which was empty gray divs standing
 * in for card text. Same two-column kanban idea, but every card carries
 * real (illustrative) content — a name, a source, a timestamp — so it reads
 * as a designed diagram instead of a wireframe placeholder.
 */
export function PipelineIllustration() {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 overflow-hidden relative">
      <div className="flex items-center justify-between mb-8">
        <h3 className="font-heading font-bold text-on-surface flex items-center gap-2">
          <MaterialIcon name="bar_chart" size={20} className="text-primary" />
          Lead Pipeline
        </h3>
        <div className="flex -space-x-2">
          {["A", "M", "K"].map((initial) => (
            <div
              key={initial}
              className="w-8 h-8 rounded-full border-2 border-surface-container-lowest bg-surface-container-high flex items-center justify-center text-[10px] font-bold text-on-surface-variant"
            >
              {initial}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-outline font-bold">New Leads</div>
          {NEW_LEADS.map((lead, i) => (
            <motion.div
              key={lead.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.15 }}
              className="p-3 bg-surface rounded-xl border border-outline-variant"
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`w-6 h-6 rounded-full ${lead.color} flex items-center justify-center text-[10px] font-bold text-on-primary shrink-0`}
                >
                  {lead.initial}
                </div>
                <div className="text-xs font-bold text-on-surface truncate">{lead.name}</div>
              </div>
              <div className="text-[10px] text-on-surface-variant pl-8">{lead.meta}</div>
            </motion.div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-primary font-bold">In Progress</div>
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="p-3 bg-primary-fixed rounded-xl border border-primary-fixed-dim"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-on-primary shrink-0">
                {IN_PROGRESS.initial}
              </div>
              <div className="text-xs font-bold text-on-surface truncate">{IN_PROGRESS.name}</div>
            </div>
            <div className="flex items-center gap-1.5 pl-8">
              <MaterialIcon name="chat" size={12} className="text-primary" />
              <span className="text-[10px] text-primary font-medium">{IN_PROGRESS.meta}</span>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
