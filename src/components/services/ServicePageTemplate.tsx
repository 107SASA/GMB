"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { boostProfileLink, bookDemoLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { SERVICES, type ServiceDefinition } from "@/lib/servicesData";

export function ServicePageTemplate({ service }: { service: ServiceDefinition }) {
  const otherServices = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <main className="min-h-screen bg-background selection:bg-primary-fixed">
      <Navbar />

      {/* Breadcrumb */}
      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-on-surface-variant flex items-center gap-2">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-outline" />
          <Link href="/services" className="hover:text-primary transition-colors">OnDemand Service</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-outline" />
          <span className="text-on-surface font-medium">{service.name}</span>
        </nav>
      </div>

      {/* Hero */}
      <section className="relative pt-10 pb-20 px-6 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-16 h-16 mx-auto rounded-2xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center mb-8"
          >
            <MaterialIcon name={service.icon} size={30} className="text-primary" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6 leading-[1.15]"
          >
            {service.heroTitle}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-on-surface-variant max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            {service.heroDescription}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <a
              href={bookDemoLink()}
              {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="w-full sm:w-auto px-8 py-4 bg-whatsapp text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all card-shadow"
            >
              <MaterialIcon name="chat" size={20} className="text-white" />
              Book Free Demo
            </a>
            <Link
              href="/free-report"
              className="w-full sm:w-auto px-8 py-4 bg-primary text-on-primary rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary-container transition-all card-shadow"
            >
              Get My Free Report
              <MaterialIcon name="arrow_forward" size={20} className="text-on-primary" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* What's included */}
      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-heading text-2xl md:text-4xl font-bold text-on-surface mb-4">
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
              className="p-8 rounded-xl bg-surface-container-lowest card-shadow border border-outline-variant"
            >
              <div className="w-12 h-12 rounded-xl bg-primary-fixed text-primary flex items-center justify-center mb-6">
                <MaterialIcon name={item.icon} size={24} />
              </div>
              <h3 className="font-heading text-xl font-bold text-on-surface mb-3">{item.title}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-6 bg-surface-container-lowest">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-heading text-2xl md:text-4xl font-bold text-on-surface mb-4">
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
                <div className="w-9 h-9 rounded-lg bg-secondary-container/40 text-secondary flex items-center justify-center shrink-0 mt-1">
                  <MaterialIcon name="check" size={20} />
                </div>
                <div>
                  <h3 className="font-heading text-lg font-bold text-on-surface mb-1">{b.title}</h3>
                  <p className="text-on-surface-variant leading-relaxed">{b.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-20 px-6 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-heading text-2xl md:text-4xl font-bold text-on-surface mb-4">
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
              className="relative p-6 rounded-xl border border-outline-variant bg-surface-container-lowest card-shadow"
            >
              <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-heading font-bold mb-4">
                {idx + 1}
              </div>
              <h3 className="font-heading font-bold text-on-surface mb-2">{step.title}</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6 max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-heading text-2xl md:text-4xl font-bold text-on-surface mb-4">
            {service.name} FAQs
          </h2>
        </div>
        <FaqAccordion faqs={service.faqs} />
      </section>

      {/* Related services */}
      <section className="py-20 px-6 bg-surface-container-lowest">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-heading text-xl md:text-2xl font-bold text-on-surface mb-8 text-center">
            Explore other services
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {otherServices.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="group p-6 rounded-xl border border-outline-variant bg-surface-container-lowest hover:border-primary/40 card-shadow transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-primary-fixed text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <MaterialIcon name={s.icon} size={20} />
                </div>
                <h3 className="font-heading font-bold text-on-surface mb-1 group-hover:text-primary transition-colors">{s.name}</h3>
                <p className="text-sm text-on-surface-variant">{s.tagline}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-gradient-to-br from-primary via-primary-container to-secondary relative overflow-hidden text-center card-shadow">
          <div className="absolute top-0 left-0 w-full h-full bg-primary/10" />
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-on-primary/10 blur-[80px] rounded-full" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-on-primary mb-6">
              Ready to get started with {service.name}?
            </h2>
            <p className="text-on-primary-container text-lg max-w-2xl mx-auto mb-10">
              Run a free audit of your Google Business Profile, or book a free demo on WhatsApp — no credit card required.
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
