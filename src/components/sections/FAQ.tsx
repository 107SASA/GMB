"use client";

import Link from "next/link";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { HOMEPAGE_FAQS } from "@/lib/faqData";

export function FAQ() {
  return (
    <section id="faq" className="py-14 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 bg-[#f7faf8]">
      <div className="max-w-3xl mx-auto">
        <h2 className="font-heading text-2xl sm:text-3xl md:text-5xl font-bold text-[#181c1c] tracking-tight text-center mb-8 sm:mb-12 md:mb-16">
          Common Questions from Business Owners
        </h2>

        <FaqAccordion faqs={HOMEPAGE_FAQS} />

        <div className="text-center mt-10">
          <Link href="/faq" className="text-sm font-semibold text-[#006e2c] hover:underline">
            See the full FAQ →
          </Link>
        </div>
      </div>
    </section>
  );
}
