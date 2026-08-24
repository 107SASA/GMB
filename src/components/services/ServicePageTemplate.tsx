"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { SERVICES, type ServiceDefinition } from "@/lib/servicesData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";

export function ServicePageTemplate({ service }: { service: ServiceDefinition }) {
  const otherServices = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <Link href="/services" className="hover:text-[#006e2c] transition-colors">OnDemand Service</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#101613] font-medium">{service.name}</span>
        </nav>
      </div>

      <section className="relative pt-10 pb-20 px-6 overflow-hidden">
        <div className="relative max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-16 h-16 mx-auto rounded-xl bg-[#e8f8ee] border border-[#c8ebd4] flex items-center justify-center mb-8"
          >
            <MaterialIcon name={service.icon} size={30} className="text-[#006e2c]" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-mkt-display text-3xl md:text-5xl font-bold text-[#101613] mb-6 leading-[1.15]"
          >
            {service.heroTitle}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-[#3d4a3d] max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            {service.heroDescription}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center justify-center"
          >
            <BookDemoButton
              origin={`service:${service.slug}`}
              iconSize={20}
              className="w-full sm:w-auto px-8 py-4 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all shadow-md"
            />
          </motion.div>
        </div>
      </section>

      {/* What's included / Why it matters — two columns side by side instead
          of two separate stacked full-width sections. */}
      <section className="relative py-16 sm:py-20 px-6 bg-(--mkt-surface)">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          <div className="lg:col-span-7">
            <p className="mkt-label text-[#006e2c] mb-3">What&apos;s included</p>
            <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613] mb-8">
              Everything in this service
            </h2>
            <div className="flex flex-col divide-y divide-(--mkt-line) border-t border-b border-(--mkt-line)">
              {service.includes.map((item, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: idx * 0.06 }}
                  viewport={{ once: true }}
                  className="flex items-start gap-4 py-5"
                >
                  <div className="w-10 h-10 rounded-lg bg-white border border-(--mkt-line) text-[#006e2c] flex items-center justify-center shrink-0">
                    <MaterialIcon name={item.icon} size={20} />
                  </div>
                  <div>
                    <h3 className="font-mkt-display text-base font-semibold text-[#101613] mb-1">{item.title}</h3>
                    <p className="text-[#3d4a3d] text-sm leading-relaxed">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-24">
              <p className="mkt-label text-[#006e2c] mb-3">Why it matters</p>
              <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613] mb-8">
                The difference it makes
              </h2>
              <div className="flex flex-col gap-6">
                {service.benefits.map((b, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: idx * 0.06 }}
                    viewport={{ once: true }}
                    className="flex items-start gap-3"
                  >
                    <MaterialIcon name="check_circle" size={18} className="text-[#006e2c] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-[#101613] mb-0.5">{b.title}</h3>
                      <p className="text-[#3d4a3d] text-sm leading-relaxed">{b.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — compact horizontal row, not boxed cards */}
      <section className="py-16 sm:py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <p className="mkt-label text-[#006e2c] mb-3 text-center">How it works</p>
          <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613] mb-12 text-center">
            From connected profile to running service
          </h2>
          <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
            <div className="hidden lg:block absolute top-4 left-0 right-0 h-px bg-(--mkt-line)" aria-hidden />
            {service.process.map((step, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: idx * 0.06 }}
                viewport={{ once: true }}
                className="relative lg:pr-4"
              >
                <span className="relative z-10 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#006e2c] text-white font-mkt-mono text-xs font-bold mb-3">
                  {idx + 1}
                </span>
                <h3 className="font-mkt-display font-semibold text-[#101613] mb-1.5">{step.title}</h3>
                <p className="text-sm text-[#3d4a3d] leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 px-6 max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <p className="mkt-label text-[#006e2c] mb-2">FAQ</p>
          <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613]">
            {service.name} FAQs
          </h2>
        </div>
        <div className="bg-white rounded-xl border border-(--mkt-line) shadow-sm p-6 md:p-8">
          <FaqAccordion faqs={service.faqs} />
        </div>
      </section>

      <section className="py-16 sm:py-20 px-6 bg-(--mkt-surface)">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-[#101613] mb-8 text-center">
            Explore other services
          </h2>
          <div className="rounded-2xl border border-(--mkt-line) bg-white overflow-hidden shadow-card">
            {otherServices.map((s, idx) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className={`group flex items-center gap-4 px-5 sm:px-7 py-4 hover:bg-(--mkt-surface) transition-colors ${
                  idx !== 0 ? "border-t border-(--mkt-line)" : ""
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <MaterialIcon name={s.icon} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-mkt-display font-semibold text-[#101613] group-hover:text-[#006e2c] transition-colors">
                    {s.name}
                  </h3>
                  <p className="text-sm text-[#3d4a3d] truncate">{s.tagline}</p>
                </div>
                <MaterialIcon name="arrow_forward" size={18} className="text-[#9aa59c] group-hover:text-[#006e2c] transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <InkCtaPanel
        heading={`Ready to get started with ${service.name}?`}
        description="Book a free demo and we'll walk you through it — no credit card required."
      >
        <BookDemoButton
          origin={`service:${service.slug}:final-cta`}
          className="px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md"
        />
      </InkCtaPanel>

      <Footer />
    </main>
  );
}
