"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Rajesh Kumar",
    business: "RK Dental Clinic",
    quote: "GMBBoost AI transformed our local ranking. We went from page 3 to the top 3 in just 2 weeks. The AI review replies are a lifesaver!",
    rating: 5
  },
  {
    name: "Sarah Miller",
    business: "The Coffee House",
    quote: "The content scheduler is incredible. It knows exactly what our local customers want to see. Our engagement is up by 150%.",
    rating: 5
  },
  {
    name: "Amit Patel",
    business: "Bright Minds Academy",
    quote: "The WhatsApp AI agent captures leads even when we are closed. It's like having a 24/7 receptionist. Highly recommended!",
    rating: 5
  }
];

export function Testimonials() {
  return (
    <section id="testimonials" className="py-24 px-6 max-w-7xl mx-auto overflow-hidden">
      <div className="text-center mb-20">
        <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6">Loved by <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Local Business Owners</span></h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {testimonials.map((t, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: idx * 0.1 }}
            viewport={{ once: true }}
            className="p-8 rounded-3xl bg-white border border-slate-200 shadow-sm relative"
          >
            <div className="flex gap-1 mb-6">
              {[...Array(t.rating)].map((_, i) => (
                <Star key={i} className="w-4 h-4 fill-primary text-primary" />
              ))}
            </div>
            <p className="text-lg italic text-slate-600 mb-8 leading-relaxed">"{t.quote}"</p>
            <div>
              <div className="font-bold text-slate-900">{t.name}</div>
              <div className="text-sm text-slate-400">{t.business}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-[40px] bg-gradient-to-br from-primary via-secondary to-accent relative overflow-hidden text-center">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full bg-black/20" />
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/20 blur-[80px] rounded-full" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-primary/40 blur-[80px] rounded-full" />
        
        <div className="relative z-10">
          <h2 className="text-4xl md:text-6xl font-extrabold text-white mb-8">
            Ready to Grow Your <br /> Local Business Using AI?
          </h2>
          <p className="text-indigo-100 text-lg md:text-xl max-w-2xl mx-auto mb-12">
            Join 500+ businesses already automating their growth. Start your 14-day free trial today.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/onboarding" className="w-full sm:w-auto px-10 py-5 bg-white text-slate-900 rounded-2xl font-bold hover:bg-slate-50 hover:scale-105 transition-all shadow-xl">
              Start Free Audit
            </Link>
            <Link href="/login" className="w-full sm:w-auto px-10 py-5 bg-slate-900/50 border border-white/20 text-white rounded-2xl font-bold hover:bg-slate-900/70 hover:scale-105 transition-all backdrop-blur-sm shadow-xl">
              Book Demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
