"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STATUS_MESSAGES = [
  "Analyzing your Google Business Profile…",
  "Checking your reviews and rating…",
  "Comparing nearby competitors…",
  "Scanning your local search ranking…",
  "Putting together your action plan…",
];

/**
 * Full-screen engaging state while an audit is generating — replaces the
 * old layout that showed the pricing sidebar right next to the spinner
 * before the report even existed. No pricing card here on purpose; that
 * only mounts once the audit is COMPLETED (see free-report/result/page.tsx).
 */
export function ReportGeneratingAnimation() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-md">
        {/* Self-drawing growth ring — a circular progress-feeling motif that
            never "completes," matching the honest indeterminate nature of
            the wait instead of faking a percentage we don't have. */}
        <div className="relative w-40 h-40 mb-10">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-surface-container)" strokeWidth="6" />
            <motion.circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="264"
              animate={{ strokeDashoffset: [264, 40, 264] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              className="w-16 h-16 rounded-full bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center"
            >
              <img src="/brand/icon.png" alt="" aria-hidden="true" className="w-9 h-9 object-contain" />
            </motion.div>
          </div>
        </div>

        <h1 className="font-heading text-2xl font-bold text-on-surface mb-3">
          Generating your report…
        </h1>

        <div className="h-6 mb-8">
          <AnimatePresence mode="wait">
            <motion.p
              key={messageIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="text-on-surface-variant text-sm"
            >
              {STATUS_MESSAGES[messageIndex]}
            </motion.p>
          </AnimatePresence>
        </div>

        <p className="text-outline text-xs">This usually takes about 20–30 seconds.</p>
      </div>
    </div>
  );
}
