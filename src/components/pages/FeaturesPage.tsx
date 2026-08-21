"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Features } from "@/components/sections/Features";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";

export function FeaturesPage() {
  return (
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#181c1c] font-medium">Features</span>
        </nav>
      </div>

      <section className="pt-10 px-6 max-w-4xl mx-auto text-center">
        <h1 className="font-heading text-3xl md:text-5xl font-bold text-[#181c1c] mb-6 leading-[1.15]">
          Everything included in GrowwMatics AI
        </h1>
        <p className="text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
          One dashboard covering your Google Business Profile audit, AI content, review automation, CRM and
          analytics — see exactly what&apos;s included, or go deeper on any single capability under{" "}
          <Link href="/services" className="text-[#006e2c] font-semibold hover:underline">OnDemand Service</Link>.
        </p>
      </section>

      <Features />

      <section className="py-20 md:py-28 px-6 md:px-12">
        <div
          className="max-w-[1184px] mx-auto rounded-3xl px-8 py-16 md:px-16 md:py-20 text-center shadow-lg"
          style={{ backgroundImage: "linear-gradient(135deg, #07b04c 0%, #006e2c 100%)" }}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-white mb-6">
            See it running on your own profile
          </h2>
          <p className="text-white/85 text-lg max-w-2xl mx-auto mb-10">
            Run a free audit of your Google Business Profile in minutes — no credit card required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <FreeReportButton className="w-full sm:w-auto px-10 py-4 bg-white text-[#006e2c] rounded-lg font-bold hover:bg-[#f7faf8] transition-all shadow-md" />
            <BookDemoButton
              origin="features-page:final-cta"
              className="w-full sm:w-auto px-10 py-4 bg-white/15 border border-white/40 text-white rounded-lg font-bold hover:bg-white/25 transition-all"
            />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
