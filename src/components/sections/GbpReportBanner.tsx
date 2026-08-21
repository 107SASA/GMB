"use client";

import { motion } from "framer-motion";
import { FreeReportButton } from "@/components/shared/FreeReportButton";

export function GbpReportBanner() {
  return (
    <section className="px-4 sm:px-6 md:px-12 py-6 sm:py-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-[1184px] mx-auto rounded-xl sm:rounded-2xl md:rounded-3xl bg-[#006e2c] px-5 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 sm:gap-6 shadow-lg"
      >
        <div className="max-w-xl">
          <h2 className="font-heading text-xl sm:text-2xl md:text-3xl font-bold text-white leading-snug mb-2">
            Get Your Free Google Business Profile Rank Report
          </h2>
          <p className="text-white/85 text-sm md:text-base leading-relaxed">
            Run a free audit of your Google Business Profile in minutes. No credit card required.
          </p>
        </div>
        <FreeReportButton
          className="w-full md:w-auto px-6 py-3.5 rounded-lg bg-white text-[#006e2c] font-semibold hover:bg-[#f7faf8] transition-colors shrink-0 shadow-md min-h-[48px]"
        >
          Get Your Free GBP Report
        </FreeReportButton>
      </motion.div>
    </section>
  );
}
