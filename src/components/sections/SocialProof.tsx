"use client";

import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

/**
 * Closing CTA — a deep green-to-charcoal tonal panel, distinct from the
 * neutral-ink "AI engine" panels used elsewhere (this is a CTA moment, not
 * a product-data moment, so it gets its own dark treatment: brand green
 * rather than near-black). One soft top-lit highlight suggests depth —
 * product-photography lighting, not a decorative effect — no repeating
 * pattern, no particles, no grid.
 */
export function FinalCTA() {
  return (
    <section className="px-4 sm:px-6 md:px-12 pb-12 sm:pb-16 md:pb-20">
      <div
        className="relative overflow-hidden max-w-[1184px] mx-auto rounded-2xl px-5 py-12 sm:px-8 sm:py-16 md:px-16 md:py-20 text-center"
        style={{ background: "linear-gradient(160deg, #0e3d22 0%, #081912 65%, #060f0b 100%)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-2/3"
          style={{ background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(74,222,128,0.14), transparent 70%)" }}
        />
        <div className="relative">
          <div className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/15 mb-6">
            <MaterialIcon name="bolt" size={13} className="text-[#4ade80]" />
            <span className="text-[#4ade80]">Ready when you are</span>
          </div>
          <h2 className="font-mkt-display text-2xl sm:text-3xl md:text-5xl font-semibold text-white tracking-tight mb-4 leading-tight">
            Put your Google Business Profile on autopilot.
          </h2>
          <p className="text-white/70 text-base sm:text-lg max-w-2xl mx-auto mb-8 sm:mb-10">
            Book a short call and we'll show the AI engine running on a profile like yours.
          </p>
          <BookDemoButton
            origin="final-cta"
            className="w-full sm:w-auto px-8 sm:px-10 py-3.5 sm:py-4 rounded-lg bg-[#4ade80] text-[#0a120e] font-bold hover:bg-[#6ee89b] transition-colors shadow-md min-h-[48px]"
          />
        </div>
      </div>
    </section>
  );
}
