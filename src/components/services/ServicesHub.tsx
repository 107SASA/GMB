"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { SERVICES } from "@/lib/servicesData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";

export function ServicesHub() {
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#101613] font-medium">OnDemand Service</span>
        </nav>
      </div>

      <section className="relative pt-10 pb-16 px-6 overflow-hidden">
        <div className="relative max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--mkt-line) bg-white text-[#006e2c] mb-8"
          >
            <MaterialIcon name="auto_awesome" size={13} className="text-[#006e2c]" />
            OnDemand Service
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-mkt-display text-3xl md:text-5xl font-bold text-[#101613] mb-6 leading-[1.15]"
          >
            Every service your Google Business Profile needs,{" "}
            <span className="text-[#006e2c]">on demand</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed"
          >
            From ranking higher on Maps to automating your follow-up and getting a strategy session grounded in your
            own data — pick the service you need, or use all five as one connected system.
          </motion.p>
        </div>
      </section>

      {/* Directory — compact scannable rows, not a card gallery, so all 5
          services are visible with little to no scrolling. */}
      <section className="py-8 px-6 max-w-4xl mx-auto">
        <div className="rounded-2xl border border-(--mkt-line) bg-white overflow-hidden shadow-card">
          {SERVICES.map((service, idx) => (
            <motion.div
              key={service.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.06 }}
              viewport={{ once: true }}
            >
              <Link
                href={`/services/${service.slug}`}
                className={`group flex items-center gap-4 sm:gap-5 px-5 sm:px-7 py-5 hover:bg-(--mkt-surface) transition-colors ${
                  idx !== 0 ? "border-t border-(--mkt-line)" : ""
                }`}
              >
                <span className="font-mkt-mono text-xs text-[#9aa59c] shrink-0 w-5">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <MaterialIcon name={service.icon} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-mkt-display text-base sm:text-lg font-semibold text-[#101613] group-hover:text-[#006e2c] transition-colors">
                    {service.name}
                  </h2>
                  <p className="text-[#3d4a3d] text-sm leading-snug truncate">{service.tagline}</p>
                </div>
                <MaterialIcon
                  name="arrow_forward"
                  size={18}
                  className="text-[#9aa59c] group-hover:text-[#006e2c] group-hover:translate-x-0.5 transition-all shrink-0"
                />
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <InkCtaPanel
        heading="Not sure which service you need?"
        description="Book a free demo and we'll point you to the right one."
      >
        <BookDemoButton
          origin="services-hub:final-cta"
          className="px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md"
        />
      </InkCtaPanel>

      <Footer />
    </main>
  );
}
