"use client";

import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function FinalCTA() {
  return (
    <section className="px-4 sm:px-6 md:px-12 pb-14 sm:pb-20 md:pb-28">
      <div
        className="max-w-[1184px] mx-auto rounded-2xl sm:rounded-3xl px-5 py-12 sm:px-8 sm:py-16 md:px-16 md:py-24 text-center shadow-lg"
        style={{
          backgroundImage: "linear-gradient(135deg, #07b04c 0%, #006e2c 100%)",
        }}
      >
        <h2 className="font-heading text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-3 sm:mb-4 leading-tight">
          Marketing that actually delivers revenue.
        </h2>
        <p className="text-white/85 text-base sm:text-lg md:text-xl max-w-2xl mx-auto mb-8 sm:mb-10">
          Run a free audit of your Google Business Profile in minutes. No credit card required.
        </p>
        <BookDemoButton
          origin="final-cta"
          className="w-full sm:w-auto px-8 sm:px-10 py-3.5 sm:py-4 rounded-lg bg-white text-[#006e2c] font-bold hover:bg-[#f7faf8] transition-colors shadow-md min-h-[48px]"
        />
      </div>
    </section>
  );
}
