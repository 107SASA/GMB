"use client";

import Link from "next/link";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { HOMEPAGE_FAQS } from "@/lib/faqData";
import { SectionHeading, Accent } from "@/components/ui/SectionHeading";

export function FAQ() {
  return (
    <section id="faq" className="py-24 px-6 max-w-3xl mx-auto">
      <SectionHeading
        eyebrow="FAQ"
        title={
          <>
            Frequently Asked <Accent>Questions</Accent>
          </>
        }
        className="mb-16"
      />

      <FaqAccordion faqs={HOMEPAGE_FAQS} />

      <div className="text-center mt-10">
        <Link href="/faq" className="text-sm font-semibold text-primary hover:underline">
          See the full FAQ →
        </Link>
      </div>
    </section>
  );
}
