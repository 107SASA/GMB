"use client";

import { motion } from "framer-motion";

const NODE_POSITIONS = [100, 300, 500, 700];

/**
 * Self-drawing connector for the desktop (4-in-a-row) HowItWorks layout —
 * replaces the plain static gradient divider line. Mobile/tablet keep the
 * simple vertical line between stacked steps (unaffected, handled in
 * HowItWorks.tsx directly since that layout doesn't need a path).
 */
export function ProcessPath() {
  return (
    <svg
      viewBox="0 0 800 20"
      preserveAspectRatio="none"
      className="absolute top-1/2 left-0 w-full h-5 -translate-y-1/2 hidden lg:block pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="processPathGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#00386c" />
          <stop offset="100%" stopColor="#006c45" />
        </linearGradient>
      </defs>
      <motion.line
        x1="0"
        y1="10"
        x2="800"
        y2="10"
        stroke="url(#processPathGradient)"
        strokeWidth="2"
        strokeDasharray="1 10"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
      />
      {NODE_POSITIONS.map((cx, i) => (
        <motion.circle
          key={cx}
          cx={cx}
          cy={10}
          r={4}
          fill="#006c45"
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3, delay: 0.3 + i * 0.25 }}
        />
      ))}
    </svg>
  );
}
