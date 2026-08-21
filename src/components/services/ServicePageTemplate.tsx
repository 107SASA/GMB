"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { SERVICES, type ServiceDefinition } from "@/lib/servicesData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function ServicePageTemplate({ service }: { service: ServiceDefinition }) {
  const otherServices = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <Link href="/services" className="hover:text-[#006e2c] transition-colors">OnDemand Service</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#181c1c] font-medium">{service.name}</span>
        </nav>
      </div>

      <section className="relative pt-10 pb-20 px-6 overflow-hidden">
        <div className="relative max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-16 h-16 mx-auto rounded-2xl bg-[#e8f8ee] border border-[#c8ebd4] flex items-center justify-center mb-8"
          >
            <MaterialIcon name={service.icon} size={30} className="text-[#006e2c]" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-heading text-3xl md:text-5xl font-bold text-[#181c1c] mb-6 leading-[1.15]"
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

      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-heading text-2xl md:text-4xl font-bold text-[#181c1c] mb-4">
            What&apos;s included
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {service.includes.map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              viewport={{ once: true }}
              className="p-8 rounded-2xl bg-white shadow-sm border border-[#e0e3e1]"
            >
              <div className="w-12 h-12 rounded-xl bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center mb-6">
                <MaterialIcon name={item.icon} size={24} />
              </div>
              <h3 className="font-heading text-xl font-bold text-[#181c1c] mb-3">{item.title}</h3>
              <p className="text-[#3d4a3d] text-sm leading-relaxed">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-heading text-2xl md:text-4xl font-bold text-[#181c1c] mb-4">
              Why it matters
            </h2>
          </div>
          <div className="space-y-8">
            {service.benefits.map((b, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.08 }}
                viewport={{ once: true }}
                className="flex items-start gap-5"
              >
                <div className="w-9 h-9 rounded-lg bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center shrink-0 mt-1">
                  <MaterialIcon name="check" size={20} />
                </div>
                <div>
                  <h3 className="font-heading text-lg font-bold text-[#181c1c] mb-1">{b.title}</h3>
                  <p className="text-[#3d4a3d] leading-relaxed">{b.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-heading text-2xl md:text-4xl font-bold text-[#181c1c] mb-4">
            How it works
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {service.process.map((step, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              viewport={{ once: true }}
              className="relative p-6 rounded-2xl border border-[#e0e3e1] bg-white shadow-sm"
            >
              <div className="w-9 h-9 rounded-full bg-[#06b34c] text-white flex items-center justify-center font-heading font-bold mb-4">
                {idx + 1}
              </div>
              <h3 className="font-heading font-bold text-[#181c1c] mb-2">{step.title}</h3>
              <p className="text-sm text-[#3d4a3d] leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="py-20 px-6 max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-heading text-2xl md:text-4xl font-bold text-[#181c1c] mb-4">
            {service.name} FAQs
          </h2>
        </div>
        <div className="bg-white rounded-2xl border border-[#e0e3e1] shadow-sm p-6 md:p-8">
          <FaqAccordion faqs={service.faqs} />
        </div>
      </section>

      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-heading text-xl md:text-2xl font-bold text-[#181c1c] mb-8 text-center">
            Explore other services
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {otherServices.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="group p-6 rounded-2xl border border-[#e0e3e1] bg-[#f7faf8] hover:border-[#06b34c]/40 shadow-sm transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <MaterialIcon name={s.icon} size={20} />
                </div>
                <h3 className="font-heading font-bold text-[#181c1c] mb-1 group-hover:text-[#006e2c] transition-colors">
                  {s.name}
                </h3>
                <p className="text-sm text-[#3d4a3d]">{s.tagline}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28 px-6 md:px-12">
        <div
          className="max-w-[1184px] mx-auto rounded-3xl px-8 py-16 md:px-16 md:py-20 text-center shadow-lg"
          style={{ backgroundImage: "linear-gradient(135deg, #07b04c 0%, #006e2c 100%)" }}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-white mb-6">
            Ready to get started with {service.name}?
          </h2>
          <p className="text-white/85 text-lg max-w-2xl mx-auto mb-10">
            Book a free demo and we&apos;ll walk you through it — no credit card required.
          </p>
          <BookDemoButton
            origin={`service:${service.slug}:final-cta`}
            className="px-10 py-4 bg-white text-[#006e2c] rounded-lg font-bold hover:bg-[#f7faf8] transition-all shadow-md"
          />
        </div>
      </section>

      <Footer />
    </main>
  );
}
