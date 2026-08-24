"use client";

import Link from "next/link";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { HOMEPAGE_FAQS } from "@/lib/faqData";

export function FAQ() {
  return (
    <section id="faq" className="py-14 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 bg-(--mkt-surface)">
      <div className="max-w-3xl mx-auto">
        <p className="mkt-label text-[#006e2c] text-center mb-2">FAQ</p>
        <h2 className="font-mkt-display text-2xl sm:text-3xl md:text-5xl font-semibold text-[#101613] tracking-tight text-center mb-8 sm:mb-12 md:mb-16">
          Common questions from business owners
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
