"use client";

import Link from "next/link";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

export function FinalCTA() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-gradient-to-br from-primary via-primary-container to-secondary relative overflow-hidden text-center card-shadow">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full bg-primary/10" />
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-on-primary/10 blur-[80px] rounded-full" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-secondary/30 blur-[80px] rounded-full" />

        <div className="relative z-10">
          <h2 className="font-heading text-4xl md:text-6xl font-extrabold text-on-primary mb-8">
            Ready to Grow Your <br /> Local Business Using AI?
          </h2>
          {/* Copy must match what a signup actually gets. There is no 14-day
              trial — /api/onboarding sets trialStatus.isActive = false; new
              users get the freemium audit gate (one free audit, then upgrade). */}
          <p className="text-on-primary-container text-lg md:text-xl max-w-2xl mx-auto mb-12">
            Run a free audit of your Google Business Profile in minutes. No credit card required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/free-report"
              className="w-full sm:w-auto px-10 py-5 bg-surface-container-lowest text-on-surface rounded-lg font-bold hover:bg-surface-container-low transition-all card-shadow"
            >
              Get My Free Report
            </Link>
            <a
              href={boostProfileLink()}
              {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="w-full sm:w-auto px-10 py-5 bg-whatsapp text-white rounded-lg font-bold hover:opacity-90 transition-all card-shadow"
            >
              Get Report on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
