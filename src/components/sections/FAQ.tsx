"use client";

import Link from "next/link";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { HOMEPAGE_FAQS } from "@/lib/faqData";

export function FAQ() {
  return (
    <section id="faq" className="py-24 px-6 max-w-3xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6">
          Frequently Asked{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
            Questions
          </span>
        </h2>
      </div>

      <FaqAccordion faqs={HOMEPAGE_FAQS} />

      <div className="text-center mt-10">
        <Link href="/faq" className="text-sm font-semibold text-primary hover:underline">
          See the full FAQ →
        </Link>
      </div>
    </section>
  );
}
