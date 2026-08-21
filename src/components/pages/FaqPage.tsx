"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { ALL_FAQS } from "@/lib/faqData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function FaqPage() {
  return (
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#181c1c] font-medium">FAQ</span>
        </nav>
      </div>

      <section className="pt-10 pb-6 px-6 max-w-3xl mx-auto text-center">
        <h1 className="font-heading text-3xl md:text-5xl font-bold text-[#181c1c] mb-6 leading-[1.15]">
          Frequently Asked Questions
        </h1>
        <p className="text-lg text-[#3d4a3d] leading-relaxed">
          Questions specific to a service? Check the FAQ on its{" "}
          <Link href="/services" className="text-[#006e2c] font-semibold hover:underline">service page</Link>.
        </p>
      </section>

      <section className="py-10 px-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-[#e0e3e1] shadow-sm p-6 md:p-8">
          <FaqAccordion faqs={ALL_FAQS} defaultOpenIndex={0} />
        </div>
      </section>

      <section className="py-20 md:py-28 px-6 md:px-12">
        <div
          className="max-w-[1184px] mx-auto rounded-3xl px-8 py-16 md:px-16 md:py-20 text-center shadow-lg"
          style={{ backgroundImage: "linear-gradient(135deg, #07b04c 0%, #006e2c 100%)" }}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-white mb-6">
            Still have questions?
          </h2>
          <p className="text-white/85 text-lg max-w-2xl mx-auto mb-10">
            Book a free demo and ask us directly.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/contact"
              className="w-full sm:w-auto px-10 py-4 bg-white text-[#006e2c] rounded-lg font-bold hover:bg-[#f7faf8] transition-all shadow-md"
            >
              Contact Us
            </Link>
            <BookDemoButton
              origin="faq-page:final-cta"
              className="w-full sm:w-auto px-10 py-4 bg-white/15 border border-white/40 text-white rounded-lg font-bold hover:bg-white/25 transition-all"
            />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
