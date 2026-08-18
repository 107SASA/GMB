"use client";

import { PricingCards } from "./pricing/PricingCards";
import { SectionHeading, Accent } from "@/components/ui/SectionHeading";

export function Pricing() {
  return (
    <section id="pricing" className="py-32 relative bg-surface-container-lowest overflow-hidden">
      {/* Soft trust blue / growth green atmosphere — two static glows, no
          dead "animate-blob" classes (those had no matching @keyframes
          anywhere in the project, so they were never actually animating). */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] max-w-[1200px] pointer-events-none">
        <div className="absolute top-20 left-20 w-[400px] h-[400px] bg-primary-fixed rounded-full blur-[100px] opacity-40" />
        <div className="absolute top-40 right-20 w-[400px] h-[400px] bg-secondary-container/60 rounded-full blur-[100px] opacity-40" />
      </div>

      <SectionHeading
        eyebrow="Pricing"
        title={
          <>
            Choose Your <Accent>Growth Plan</Accent>
          </>
        }
        description="Start small and scale your local business with AI-powered Google Business Profile optimization and lead conversion."
        className="relative z-10 mb-20 px-4"
      />

      <PricingCards />
    </section>
  );
}
