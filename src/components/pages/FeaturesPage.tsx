"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Features } from "@/components/sections/Features";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function FeaturesPage() {
  return (
    <main className="theme-marketing min-h-screen bg-background selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-on-surface-variant flex items-center gap-2">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-outline" />
          <span className="text-on-surface font-medium">Features</span>
        </nav>
      </div>

      <section className="pt-10 px-6 max-w-4xl mx-auto text-center">
        <h1 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6 leading-[1.15]">
          Everything included in GrowwMatics AI
        </h1>
        <p className="text-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
          One dashboard covering your Google Business Profile audit, AI content, review automation, CRM and
          analytics — see exactly what's included, or go deeper on any single capability under{" "}
          <Link href="/services" className="text-primary font-semibold hover:underline">OnDemand Service</Link>.
        </p>
      </section>

      <Features />

      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-gradient-to-br from-primary via-primary-container to-secondary relative overflow-hidden text-center card-shadow">
          <div className="absolute top-0 left-0 w-full h-full bg-primary/10" />
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-on-primary/10 blur-[80px] rounded-full" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-on-primary mb-6">
              See it running on your own profile
            </h2>
            <p className="text-on-primary-container text-lg max-w-2xl mx-auto mb-10">
              Run a free audit of your Google Business Profile in minutes — no credit card required.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/free-report"
                className="w-full sm:w-auto px-10 py-5 bg-surface-container-lowest text-on-surface rounded-lg font-bold hover:bg-surface-container-low transition-all card-shadow"
              >
                Get My Free Report
              </Link>
              <BookDemoButton
                origin="features-page:final-cta"
                className="w-full sm:w-auto px-10 py-5 bg-whatsapp text-white rounded-lg font-bold hover:opacity-90 transition-all card-shadow"
              >
                Book Free Demo on WhatsApp
              </BookDemoButton>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
