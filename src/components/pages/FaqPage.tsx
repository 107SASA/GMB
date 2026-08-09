"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { ALL_FAQS } from "@/lib/faqData";
import { bookDemoLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

export function FaqPage() {
  return (
    <main className="min-h-screen bg-background selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-on-surface-variant flex items-center gap-2">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-outline" />
          <span className="text-on-surface font-medium">FAQ</span>
        </nav>
      </div>

      <section className="pt-10 pb-6 px-6 max-w-3xl mx-auto text-center">
        <h1 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6 leading-[1.15]">
          Frequently Asked Questions
        </h1>
        <p className="text-lg text-on-surface-variant leading-relaxed">
          Questions specific to a service? Check the FAQ on its{" "}
          <Link href="/services" className="text-primary font-semibold hover:underline">service page</Link>.
        </p>
      </section>

      <section className="py-10 px-6 max-w-3xl mx-auto">
        <FaqAccordion faqs={ALL_FAQS} defaultOpenIndex={0} />
      </section>

      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-gradient-to-br from-primary via-primary-container to-secondary relative overflow-hidden text-center card-shadow">
          <div className="absolute top-0 left-0 w-full h-full bg-primary/10" />
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-on-primary/10 blur-[80px] rounded-full" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-on-primary mb-6">
              Still have questions?
            </h2>
            <p className="text-on-primary-container text-lg max-w-2xl mx-auto mb-10">
              Book a free demo on WhatsApp and ask us directly.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/contact"
                className="w-full sm:w-auto px-10 py-5 bg-surface-container-lowest text-on-surface rounded-lg font-bold hover:bg-surface-container-low transition-all card-shadow"
              >
                Contact Us
              </Link>
              <a
                href={bookDemoLink()}
                {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="w-full sm:w-auto px-10 py-5 bg-whatsapp text-white rounded-lg font-bold hover:opacity-90 transition-all card-shadow"
              >
                Book Free Demo on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
