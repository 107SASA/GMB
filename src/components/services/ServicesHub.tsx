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
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-[#3d4a3d] flex items-center gap-2">
          <Link href="/" className="hover:text-[#006e2c] transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          <span className="text-[#181c1c] font-medium">OnDemand Service</span>
        </nav>
      </div>

      <section className="relative pt-10 pb-16 px-6 overflow-hidden">
        <div className="relative max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[rgba(7,176,76,0.1)] text-sm font-semibold text-[#006e2c] mb-8"
          >
            <MaterialIcon name="auto_awesome" size={16} className="text-[#006e2c]" />
            OnDemand Service
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-heading text-3xl md:text-5xl font-bold text-[#181c1c] mb-6 leading-[1.15]"
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
                className="group block h-full p-8 rounded-2xl bg-white shadow-sm border border-[#e0e3e1] hover:border-[#06b34c]/40 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-[#e8f8ee] text-[#006e2c] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <MaterialIcon name={service.icon} size={24} />
                </div>
                <h2 className="font-heading text-xl font-bold text-[#181c1c] mb-2 group-hover:text-[#006e2c] transition-colors">
                  {service.name}
                </h2>
                <p className="text-[#3d4a3d] text-sm leading-relaxed mb-4">{service.tagline}</p>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#006e2c]">
                  Learn more
                  <MaterialIcon name="arrow_forward" size={16} className="text-[#006e2c]" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="py-20 md:py-28 px-6 md:px-12">
        <div
          className="max-w-[1184px] mx-auto rounded-3xl px-8 py-16 md:px-16 md:py-20 text-center shadow-lg"
          style={{ backgroundImage: "linear-gradient(135deg, #07b04c 0%, #006e2c 100%)" }}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-white mb-6">
            Not sure which service you need?
          </h2>
          <p className="text-white/85 text-lg max-w-2xl mx-auto mb-10">
            Book a free demo and we&apos;ll point you to the right one.
          </p>
          <BookDemoButton
            origin="services-hub:final-cta"
            className="px-10 py-4 bg-white text-[#006e2c] rounded-lg font-bold hover:bg-[#f7faf8] transition-all shadow-md"
          />
        </div>
      </section>

      <Footer />
    </main>
  );
}
