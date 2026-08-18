"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

const ParticleField = dynamic(
  () => import("@/components/backgrounds/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

export function FinalCTA() {
  return (
    <section className="py-24 px-6">
      {/* Restrained dark contrast panel — replaces the previous multi-blob
          rainbow gradient card (primary -> primary-container -> secondary,
          three colors stacked) with a single deep-navy surface and one quiet
          particle field, matching the premium-minimal FinalCTA pattern
          instead of reading as generic "AI landing page" gradient soup. */}
      <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-[#141a12] relative overflow-hidden text-center card-shadow">
        <ParticleField id="cta-particles" colors={["#0a8a3e", "#62bd32"]} density={22} opacity={0.25} />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-secondary/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative z-10">
          <h2 className="font-heading text-4xl md:text-6xl font-extrabold text-white mb-8">
            Ready to Grow Your <br /> Local Business Using AI?
          </h2>
          {/* Copy must match what a signup actually gets. There is no 14-day
              trial — /api/onboarding sets trialStatus.isActive = false; new
              users get the freemium audit gate (one free audit, then upgrade). */}
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-12">
            Run a free audit of your Google Business Profile in minutes. No credit card required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/free-report"
              className="w-full sm:w-auto px-10 py-5 bg-white text-on-surface rounded-lg font-bold hover:bg-white/90 transition-all card-shadow"
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
