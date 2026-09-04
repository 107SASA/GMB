"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { FreeReportButton } from "@/components/shared/FreeReportButton";

/**
 * Redesigned as a light "report preview" card rather than repeating the
 * dark/gradient panel pattern used for the closing CTA (SocialProof.tsx) —
 * two CTA banners with the same visual treatment back-to-back was one of
 * the templated tells of the old design.
 */
export function GbpReportBanner() {
  return (
    <section className="px-4 sm:px-6 md:px-12 py-8 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-[1184px] mx-auto rounded-2xl border border-(--mkt-line) bg-white shadow-card px-5 py-8 sm:px-8 sm:py-10 md:px-12 md:py-12 flex flex-col md:flex-row items-center gap-8 md:gap-12"
      >
        <div className="flex-1 max-w-xl">
          <p className="mkt-label text-[#006e2c] mb-3">Free profile audit</p>
          <h2 className="font-mkt-display text-xl sm:text-2xl md:text-3xl font-semibold text-[#101613] leading-snug mb-3">
            See your Google Business Profile score before you commit to anything
          </h2>
          <p className="text-[#3d4a3d] text-sm md:text-base leading-relaxed mb-6">
            Run a free audit in minutes — no credit card required. We'll show you exactly
            what's holding your profile back.
          </p>
          <FreeReportButton className="w-full sm:w-auto px-6 py-3.5 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors shadow-sm min-h-[48px]">
            Get Your Free GBP Report
          </FreeReportButton>
        </div>

        {/* Compact report preview visual */}
        <div className="w-full md:w-[280px] shrink-0 rounded-xl border border-(--mkt-line) bg-(--mkt-surface) p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="mkt-label text-[#6b756f]">Sample Report</span>
            <MaterialIcon name="fact_check" size={16} className="text-[#006e2c]" />
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              { label: "Profile completeness", value: 72 },
              { label: "Photo freshness", value: 45 },
              { label: "Review response rate", value: 88 },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#3d4a3d]">{row.label}</span>
                  <span className="font-mkt-mono text-xs text-[#101613]">{row.value}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-(--mkt-line) overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#006e2c]"
                    style={{ width: `${row.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
