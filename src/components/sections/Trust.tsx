"use client";

import { motion } from "framer-motion";

const metrics = [
  { label: "Reviews Managed", value: "10K+", delay: 0.1 },
  { label: "Leads Captured", value: "2M+", delay: 0.2 },
  { label: "Faster Response Time", value: "98%", delay: 0.3 },
];

export function TrustSection() {
  return (
    <section className="py-20 border-y border-slate-100 bg-slate-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mb-8">Trusted by Local Businesses</p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-40 grayscale hover:grayscale-0 transition-all duration-500">
            {/* Placeholder Logos */}
            <div className="text-xl font-bold tracking-tighter text-slate-800">TECHCORP</div>
            <div className="text-xl font-bold tracking-tighter text-slate-800">SOLUTIONS</div>
            <div className="text-xl font-bold tracking-tighter text-slate-800">GLOBALNET</div>
            <div className="text-xl font-bold tracking-tighter text-slate-800">PIXELFLOW</div>
            <div className="text-xl font-bold tracking-tighter text-slate-800">VANTAGE</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {metrics.map((metric, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: metric.delay }}
              viewport={{ once: true }}
              className="text-center p-8 rounded-3xl bg-white border border-slate-200 shadow-sm"
            >
              <div className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary mb-2">{metric.value}</div>
              <div className="text-slate-500 font-medium">{metric.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
