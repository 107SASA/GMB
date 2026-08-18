"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { HeroIllustration } from "@/components/graphics/HeroIllustration";

// tsParticles touches the DOM/canvas directly and has no reason to exist on
// the server render — ssr:false keeps it fully off the SSR/LCP path.
const ParticleField = dynamic(
  () => import("@/components/backgrounds/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

const STATS = [
  { value: 60, prefix: "<", suffix: "s", label: "AI Audit Turnaround" },
  { value: 24, suffix: "/7", label: "Automated Review Replies" },
  { value: 7, suffix: "-Day", label: "Content Calendar, Auto-Scheduled" },
];

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-28 md:pt-32 lg:pt-36 pb-20 overflow-hidden bg-background">
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[120px] rounded-full" />
        <ParticleField id="hero-particles" density={30} opacity={0.3} />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-fixed border border-primary-fixed-dim text-sm font-medium text-primary mb-8"
        >
          <MaterialIcon name="auto_awesome" size={16} className="text-primary" />
          <span>AI-Powered Google Business Growth Platform</span>
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-heading text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-on-surface mb-6 leading-[1.1]"
        >
          Scale Your Local Business
          <br />
          <span className="text-primary">With AI Intelligence</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-lg md:text-xl text-on-surface-variant max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Automate your Google Business Profile, generate more reviews, convert leads faster, and grow your local visibility with AI.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
        >
          <Link
            href="/free-report"
            className="w-full sm:w-auto px-8 py-4 bg-primary text-on-primary rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary-container transition-all card-shadow"
          >
            Get My Free Report
            <MaterialIcon name="arrow_forward" size={20} className="text-on-primary" />
          </Link>
          <a
            href={boostProfileLink()}
            {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="w-full sm:w-auto px-8 py-4 bg-whatsapp text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all card-shadow"
          >
            <MaterialIcon name="chat" size={20} className="text-white" />
            Get Report on WhatsApp
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="flex items-center justify-center gap-8 md:gap-16 mb-16 flex-wrap"
        >
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-heading text-3xl md:text-4xl font-extrabold text-on-surface">
                <AnimatedCounter value={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
              </div>
              <div className="text-xs md:text-sm text-on-surface-variant font-medium mt-1 max-w-[10rem]">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <HeroIllustration />
        </motion.div>
      </div>
    </section>
  );
}
