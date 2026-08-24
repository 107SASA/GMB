"use client";

import { motion } from "framer-motion";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

/**
 * Restructured (Aug 2026) from a static 4-column card grid into a
 * continuously auto-scrolling marquee strip — a distinct, more dynamic
 * composition rather than another stacked card grid matching the rest of
 * the page. Pauses on hover/focus; disabled entirely under
 * prefers-reduced-motion (see .mkt-marquee-track in globals.css).
 */

const NICHES = [
  { title: "Gym & Fitness Centres", image: "/marketing/home/niche-gym.png" },
  { title: "Doctors & Health Clinics", image: "/marketing/home/niche-doctor.png" },
  { title: "Bakers & Cake Shops", image: "/marketing/home/niche-baker.png" },
  { title: "Salon Owners", image: "/marketing/home/niche-salon.png" },
  { title: "Restaurants & Bars", image: "/marketing/home/niche-chef.png" },
  { title: "Pest Control Businesses", image: "/marketing/home/niche-pest.png" },
  { title: "Car Garages & Mechanics", image: "/marketing/home/niche-mechanic.png" },
  { title: "Tours & Travels", image: "/marketing/home/niche-travel.png" },
  { title: "Yoga & Wellness", image: "/marketing/home/niche-yoga.png" },
  { title: "Home Services", image: "/marketing/home/niche-handyman.png" },
];

function NicheChip({ niche }: { niche: (typeof NICHES)[number] }) {
  return (
    <div className="shrink-0 w-[220px] sm:w-[240px] bg-white border border-(--mkt-line) rounded-xl p-3.5 sm:p-4 flex items-center gap-3">
      <img src={niche.image} alt="" className="w-12 h-14 sm:w-14 sm:h-16 object-contain shrink-0 rounded-md" />
      <p className="font-semibold text-[#101613] text-sm leading-snug">{niche.title}</p>
    </div>
  );
}

export function BusinessNiches() {
  return (
    <section className="py-14 sm:py-20 md:py-28 bg-(--mkt-surface) overflow-hidden">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-12">
        <div className="text-center mb-10 sm:mb-12 md:mb-16">
          <p className="mkt-label text-[#006e2c] mb-2">Who it's for</p>
          <h2 className="font-mkt-display text-2xl sm:text-3xl md:text-5xl font-semibold text-[#101613] tracking-tight mb-3 sm:mb-4">
            Built for small business owners
          </h2>
          <p className="text-base sm:text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
            Tailored AI marketing solutions designed specifically for the unique needs of local
            businesses and service providers.
          </p>
        </div>
      </div>

      {/* Full-bleed marquee — deliberately breaks the max-w container so the
          strip reads as a continuous, edge-to-edge band rather than another
          boxed section. */}
      <div className="relative">
        <div
          className="mkt-marquee-track flex w-max gap-3 sm:gap-4 px-4 sm:px-6"
          style={{ willChange: "transform" }}
        >
          {[...NICHES, ...NICHES].map((niche, i) => (
            <NicheChip key={`${niche.title}-${i}`} niche={niche} />
          ))}
        </div>
        {/* Edge fades so the loop point never looks like a hard cut */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-24 bg-gradient-to-r from-(--mkt-surface) to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-24 bg-gradient-to-l from-(--mkt-surface) to-transparent" />
      </div>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-12 mt-10 sm:mt-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-[#101613] rounded-xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-5"
        >
          <p className="font-mkt-display font-semibold text-white text-lg sm:text-xl leading-snug text-center sm:text-left">
            And many more businesses like yours
          </p>
          <BookDemoButton
            origin="niches"
            className="w-full sm:w-auto justify-center px-6 py-3 rounded-md bg-[#4ade80] text-[#0a120e] font-semibold hover:bg-[#6ee89b] transition-colors shrink-0 min-h-[48px]"
          />
        </motion.div>
      </div>
    </section>
  );
}
