"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { SERVICES } from "@/lib/servicesData";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function ServicesHub() {
  return (
    <main className="theme-marketing min-h-screen bg-background selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-on-surface-variant flex items-center gap-2">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-outline" />
          <span className="text-on-surface font-medium">OnDemand Service</span>
        </nav>
      </div>

      {/* Hero */}
      <section className="relative pt-10 pb-16 px-6 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-fixed border border-primary-fixed-dim text-sm font-medium text-primary mb-8"
          >
            <MaterialIcon name="auto_awesome" size={16} className="text-primary" />
            OnDemand Service
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6 leading-[1.15]"
          >
            Every service your Google Business Profile needs,{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
              on demand
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed"
          >
            From ranking higher on Maps to automating your follow-up and getting a strategy session grounded in your
            own data — pick the service you need, or use all five as one connected system.
          </motion.p>
        </div>
      </section>

      {/* Service cards */}
      <section className="py-8 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SERVICES.map((service, idx) => (
            <motion.div
              key={service.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              viewport={{ once: true }}
            >
              <Link
                href={`/services/${service.slug}`}
                className="group block h-full p-8 rounded-xl bg-surface-container-lowest card-shadow border border-outline-variant hover:border-primary/30 transition-all relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-12 h-12 rounded-xl bg-primary-fixed text-primary flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <MaterialIcon name={service.icon} size={24} />
                </div>
                <h2 className="font-heading text-xl font-bold text-on-surface mb-2 group-hover:text-primary transition-colors">
                  {service.name}
                </h2>
                <p className="text-on-surface-variant text-sm leading-relaxed mb-4">{service.tagline}</p>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more
                  <MaterialIcon name="arrow_forward" size={16} className="text-primary" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-gradient-to-br from-primary via-primary-container to-secondary relative overflow-hidden text-center card-shadow">
          <div className="absolute top-0 left-0 w-full h-full bg-primary/10" />
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-on-primary/10 blur-[80px] rounded-full" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-on-primary mb-6">
              Not sure which service you need?
            </h2>
            <p className="text-on-primary-container text-lg max-w-2xl mx-auto mb-10">
              Book a free consultant and we'll point you to the right one, on WhatsApp.
            </p>
            <div className="flex items-center justify-center">
              <BookDemoButton
                origin="services-hub:final-cta"
                className="w-full sm:w-auto px-10 py-5 bg-surface-container-lowest text-on-surface rounded-lg font-bold hover:bg-surface-container-low transition-all card-shadow"
              >
                Book a Free Consultant
              </BookDemoButton>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
