"use client";

import { motion } from "framer-motion";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function AgentsBanner() {
  return (
    <section className="px-4 sm:px-6 md:px-12 pb-6 sm:pb-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative max-w-[1184px] mx-auto overflow-hidden rounded-2xl sm:rounded-3xl shadow-lg"
        style={{
          backgroundImage: "linear-gradient(135deg, #07b04c 0%, #006e2c 100%)",
        }}
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-6 md:gap-10 px-5 pt-8 pb-0 sm:px-8 sm:pt-10 md:p-12 md:pr-8">
          <div className="flex flex-col gap-4 sm:gap-5 items-center text-center md:items-start md:text-left md:flex-1 md:max-w-md md:shrink-0">
            <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight">
              Team of AI Agents that work for your Business Growth
            </h2>
            <BookDemoButton
              origin="agents-banner"
              className="relative z-20 w-fit px-5 sm:px-7 py-2.5 sm:py-3 rounded-lg bg-white text-[#006e2c] font-semibold hover:bg-[#f7faf8] transition-colors shadow-md min-h-[44px] text-sm sm:text-base"
            />
          </div>

          {/* Phone sits below the CTA on mobile — never overlaps the button */}
          <div className="flex justify-center md:justify-end md:flex-1 pointer-events-none">
            <img
              src="/marketing/home/phone-dashboard.png"
              alt="Business analytics dashboard on smartphone"
              className="relative z-0 h-[180px] sm:h-[220px] md:h-[280px] lg:h-[320px] w-auto object-contain object-bottom drop-shadow-2xl translate-y-2 md:translate-y-6"
            />
          </div>
        </div>
      </motion.div>
    </section>
  );
}
