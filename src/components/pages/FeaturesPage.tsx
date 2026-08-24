"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Features } from "@/components/sections/Features";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";

export function FeaturesPage() {
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#101613] font-medium">Features</span>
        </nav>
      </div>

      <section className="relative pt-10 px-6 max-w-4xl mx-auto text-center">
        <h1 className="font-mkt-display text-3xl md:text-5xl font-bold text-[#101613] mb-6 leading-[1.15]">
          Everything included in GrowwMatics AI
        </h1>
        <p className="text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
          One dashboard covering your Google Business Profile audit, AI content, review automation, CRM and
          analytics — see exactly what&apos;s included, or go deeper on any single capability under{" "}
          <Link href="/services" className="text-[#006e2c] font-semibold hover:underline">OnDemand Service</Link>.
        </p>
      </section>

      <Features />

      <InkCtaPanel
        heading="See it running on your own profile"
        description="Run a free audit of your Google Business Profile in minutes — no credit card required."
      >
        <FreeReportButton className="w-full sm:w-auto px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md" />
        <BookDemoButton
          origin="features-page:final-cta"
          className="w-full sm:w-auto px-8 py-3.5 bg-transparent border border-(--mkt-ink-border) text-white rounded-lg font-bold hover:bg-white/5 transition-all"
        />
      </InkCtaPanel>

      <Footer />
    </main>
  );
}
