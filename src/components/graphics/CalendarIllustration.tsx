"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const SCHEDULE = [
  { day: "Mon", label: "Weekend Offer Post", state: "posted" as const },
  { day: "Wed", label: "New Menu Highlight", state: "generating" as const },
  { day: "Fri", label: "Customer Spotlight", state: "draft" as const },
];

function StatusMark({ state }: { state: (typeof SCHEDULE)[number]["state"] }) {
  if (state === "posted") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <motion.path
          d="M3 8.5L6.5 12L13 4.5"
          stroke="#006c45"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
        />
      </svg>
    );
  }
  if (state === "generating") {
    return (
      <motion.span
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"
      />
    );
  }
  return <span className="w-2.5 h-2.5 rounded-full border-2 border-outline-variant shrink-0" />;
}

const STATE_LABEL: Record<(typeof SCHEDULE)[number]["state"], { text: string; className: string }> = {
  posted: { text: "Posted", className: "text-secondary" },
  generating: { text: "Generating…", className: "text-primary" },
  draft: { text: "Draft", className: "text-outline" },
};

/**
 * Replaces the old "Weekly Schedule" mock (plain gray bars per row). Same
 * concept — a week strip with per-day status — but each row now carries a
 * real illustrative post title and an animated status mark (a checkmark
 * that draws itself in for posted days, a pulsing dot for the one currently
 * generating) instead of an empty skeleton bar.
 */
export function CalendarIllustration() {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-primary-fixed flex items-center justify-center border border-primary-fixed-dim">
          <MaterialIcon name="calendar_month" size={24} className="text-primary" />
        </div>
        <div>
          <div className="font-heading font-bold text-on-surface">Weekly Schedule</div>
          <div className="text-xs text-outline">12 Posts Scheduled</div>
        </div>
      </div>

      <div className="space-y-3">
        {SCHEDULE.map((item, i) => (
          <motion.div
            key={item.day}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.15 }}
            className="flex items-center justify-between p-4 bg-surface rounded-xl border border-outline-variant hover:border-outline transition-colors"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-8 text-sm font-bold text-on-surface-variant shrink-0">{item.day}</div>
              <div className="text-xs text-on-surface-variant truncate">{item.label}</div>
            </div>
            <div className={`flex items-center gap-2 text-xs font-bold shrink-0 ${STATE_LABEL[item.state].className}`}>
              <StatusMark state={item.state} />
              {STATE_LABEL[item.state].text}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
