"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { ALL_FAQS } from "@/lib/faqData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";

export function FaqPage() {
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#101613] font-medium">FAQ</span>
        </nav>
      </div>

      <section className="pt-10 pb-6 px-6 max-w-3xl mx-auto text-center">
        <h1 className="font-mkt-display text-3xl md:text-5xl font-bold text-[#101613] mb-6 leading-[1.15]">
          Frequently Asked Questions
        </h1>
        <p className="text-lg text-[#3d4a3d] leading-relaxed">
          Questions specific to a service? Check the FAQ on its{" "}
          <Link href="/services" className="text-[#006e2c] font-semibold hover:underline">service page</Link>.
        </p>
      </section>

      <section className="py-10 px-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-xl border border-(--mkt-line) shadow-sm p-6 md:p-8">
          <FaqAccordion faqs={ALL_FAQS} defaultOpenIndex={0} />
        </div>
      </section>

      <InkCtaPanel heading="Still have questions?" description="Book a free demo and ask us directly.">
        <Link
          href="/contact"
          className="w-full sm:w-auto px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md"
        >
          Contact Us
        </Link>
        <BookDemoButton
          origin="faq-page:final-cta"
          className="w-full sm:w-auto px-8 py-3.5 bg-transparent border border-(--mkt-ink-border) text-white rounded-lg font-bold hover:bg-white/5 transition-all"
        />
      </InkCtaPanel>

      <Footer />
    </main>
  );
}
