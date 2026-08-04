"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export function ProductShowcase() {
  return (
    <section className="py-24 px-6 bg-surface">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6">
            Powerful Tools,{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
              Simple Interface
            </span>
          </h2>
          <p className="text-on-surface-variant max-w-2xl mx-auto text-lg">
            Manage everything from reviews to lead conversion in one sleek command center.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* CRM / Kanban Mockup */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 overflow-hidden relative"
          >
            <div className="flex items-center justify-between mb-8">
              <h3 className="font-heading font-bold text-on-surface flex items-center gap-2">
                <MaterialIcon name="bar_chart" size={20} className="text-primary" />
                Lead Pipeline
              </h3>
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-surface-container-lowest bg-surface-container-high" />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="text-[10px] uppercase tracking-wider text-outline font-bold">New Leads</div>
                {[1, 2].map((i) => (
                  <div key={i} className="p-4 bg-surface rounded-xl border border-outline-variant">
                    <div className="h-3 w-2/3 bg-surface-container-high rounded mb-3" />
                    <div className="h-2 w-1/2 bg-surface-container rounded" />
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <div className="text-[10px] uppercase tracking-wider text-primary font-bold">In Progress</div>
                <div className="p-4 bg-primary-fixed rounded-xl border border-primary-fixed-dim">
                  <div className="h-3 w-3/4 bg-primary-fixed-dim rounded mb-3" />
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="chat" size={12} className="text-primary" />
                    <div className="h-2 w-1/3 bg-primary-fixed-dim/60 rounded" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Feature List */}
          <div className="space-y-8">
            <h3 className="font-heading text-3xl font-bold text-on-surface">Smart CRM & Lead Automation</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Our integrated CRM automatically captures and categorizes leads coming from your Google Business Profile, triggering personalized follow-ups that increase conversion.
            </p>
            <ul className="space-y-4">
              {[
                "Automated lead tagging",
                "Review request campaigns",
                "Multi-location pipeline view",
                "Performance tracking per agent",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-on-surface">
                  <div className="w-6 h-6 rounded-lg bg-secondary-container/40 flex items-center justify-center border border-secondary-fixed">
                    <MaterialIcon name="check" size={16} className="text-secondary" />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Second Row - Calendar/Scheduler */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mt-24">
          <div className="order-2 lg:order-1 space-y-8">
            <h3 className="font-heading text-3xl font-bold text-on-surface">AI Content Calendar</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Never worry about what to post again. Our AI generates a full month of local-optimized content based on your business category and goals.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 order-1 lg:order-2"
          >
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary-fixed flex items-center justify-center border border-primary-fixed-dim">
                <MaterialIcon name="calendar_month" size={24} className="text-primary" />
              </div>
              <div>
                <div className="font-heading font-bold text-on-surface">Weekly Schedule</div>
                <div className="text-xs text-outline">12 Posts Scheduled</div>
              </div>
            </div>

            <div className="space-y-4">
              {[
                { day: "Mon", status: "Posted", color: "text-secondary" },
                { day: "Wed", status: "Generating...", color: "text-primary animate-pulse" },
                { day: "Fri", status: "Draft", color: "text-outline" },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-4 bg-surface rounded-xl border border-outline-variant hover:border-outline transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-8 text-sm font-bold text-on-surface-variant">{item.day}</div>
                    <div className="h-2 w-32 bg-surface-container-high rounded" />
                  </div>
                  <div className={`text-xs font-bold ${item.color}`}>{item.status}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
