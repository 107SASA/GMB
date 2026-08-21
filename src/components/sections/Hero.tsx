"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";

export function Hero() {
  return (
    <section className="relative pt-24 sm:pt-28 md:pt-32 pb-12 sm:pb-16 md:pb-24 overflow-hidden bg-[#f7faf8]">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="lg:col-span-6 order-1"
          >
            <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-[rgba(7,176,76,0.1)] text-[#006e2c] text-xs sm:text-sm font-semibold mb-4 sm:mb-6">
              <MaterialIcon name="auto_awesome" size={14} className="text-[#006e2c]" />
              Marketing Platform
            </div>

            <h1 className="font-heading text-[1.75rem] leading-[1.15] sm:text-4xl md:text-5xl lg:text-[56px] xl:text-[64px] font-extrabold tracking-tight text-[#181c1c] sm:leading-[1.1] mb-4 sm:mb-6">
              Scale Your Local Business{" "}
              <span className="text-[#006e2c]">With AI Intelligence</span>
            </h1>

            <p className="text-base sm:text-lg text-[#3d4a3d] max-w-xl leading-relaxed mb-6 sm:mb-8">
              Automate your Google Business Profile, generate more reviews, convert leads faster,
              and grow your local visibility with AI.
            </p>

            <div className="flex flex-col xs:flex-row sm:flex-row flex-wrap gap-3 sm:gap-4">
              <FreeReportButton className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors shadow-md min-h-[48px] text-sm sm:text-base" />
              <BookDemoButton
                origin="hero"
                className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 rounded-lg bg-[#f7faf8] border-2 border-[#006e2c] text-[#006e2c] font-semibold hover:bg-white transition-colors min-h-[48px] text-sm sm:text-base"
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="lg:col-span-6 order-2 relative max-w-md mx-auto lg:max-w-none w-full"
          >
            <div className="absolute inset-[-8%] bg-[rgba(7,176,76,0.05)] blur-[32px] rounded-full pointer-events-none" />
            <img
              src="/marketing/home/hero-agents.png"
              alt="GrowwMatics AI agents for Google Business Profile, WhatsApp, and marketing"
              className="relative w-full h-auto drop-shadow-xl"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
