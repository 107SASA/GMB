"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-28 md:pt-32 lg:pt-36 overflow-hidden bg-background">
      {/* pt increased from pt-20 — the fixed h-16 Navbar left only ~16px of
          clearance above the "GrowwMatics AI" wordmark below, which read as
          cramped. This gives the header room to breathe before the hero
          content starts. */}
      {/* Calm trust blue / growth green atmosphere */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/15 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/15 blur-[120px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,rgba(0,56,108,0.06)_0%,transparent_70%)]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="font-heading text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-primary mb-6 md:mb-8"
        >
          GrowwMatics AI
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-heading text-2xl md:text-4xl lg:text-5xl font-bold tracking-tight text-on-surface mb-6 leading-[1.15]"
        >
          Scale Your Local Business{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
            With AI Intelligence
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-fixed border border-primary-fixed-dim text-sm font-medium text-primary mb-8"
        >
          <MaterialIcon name="auto_awesome" size={16} className="text-primary" />
          <span>AI-Powered Google Business Growth Platform</span>
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-lg md:text-xl text-on-surface-variant max-w-2xl mx-auto mb-12 leading-relaxed"
        >
          Automate your Google Business Profile, generate more reviews, convert leads faster, and grow your local visibility with AI.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
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

        {/* Hero Visual - Dashboard Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
          className="relative max-w-5xl mx-auto"
        >
          <div className="relative bg-surface-container-low/80 backdrop-blur-xl rounded-t-3xl border-t border-x border-outline-variant p-4 pb-0 overflow-hidden card-shadow">
            <div className="flex items-center gap-2 mb-4 px-2">
              <div className="w-3 h-3 rounded-full bg-outline-variant" />
              <div className="w-3 h-3 rounded-full bg-outline-variant" />
              <div className="w-3 h-3 rounded-full bg-outline-variant" />
              <div className="ml-4 px-3 py-1 rounded-lg bg-surface-container-lowest border border-outline-variant text-[10px] text-on-surface-variant">
                growwmatics.com/dashboard
              </div>
            </div>

            <div className="grid grid-cols-12 gap-4 h-[400px] md:h-[600px] bg-surface-container-lowest rounded-t-2xl border-t border-x border-outline-variant">
              {/* Sidebar Mock */}
              <div className="col-span-2 border-r border-outline-variant p-4 hidden md:block">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-8 w-full bg-surface-container rounded-lg mb-4 border border-outline-variant" />
                ))}
              </div>

              {/* Content Mock */}
              <div className="col-span-12 md:col-span-10 p-6 text-left">
                <div className="flex items-center justify-between mb-8">
                  <div className="h-8 w-48 bg-surface-container rounded-xl" />
                  <div className="h-10 w-32 bg-primary-fixed border border-primary-fixed-dim rounded-xl" />
                </div>

                <div className="grid grid-cols-3 gap-6 mb-8">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-32 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-4"
                    >
                      <div className="h-4 w-20 bg-surface-container rounded mb-4" />
                      <div className="h-8 w-24 bg-surface-container-high rounded" />
                    </div>
                  ))}
                </div>

                <div className="h-64 bg-surface rounded-xl border border-outline-variant relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-primary/40 to-transparent" />
                  <div className="p-6">
                    <div className="h-4 w-32 bg-surface-container-high rounded mb-6" />
                    <div className="flex items-end gap-2 h-32">
                      {[40, 70, 45, 90, 65, 80, 50, 85, 30, 95].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-primary-fixed-dim rounded-t-sm"
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating UI Elements */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-20 right-[-20px] md:right-10 p-4 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl border border-outline-variant card-shadow hidden sm:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary-container/40 border border-secondary-fixed rounded-lg flex items-center justify-center">
                  <MaterialIcon name="auto_awesome" size={20} className="text-secondary" />
                </div>
                <div>
                  <div className="text-[10px] text-on-surface-variant font-medium">New Lead Captured</div>
                  <div className="text-xs font-bold text-on-surface">Conversion Rate +24%</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute bottom-20 left-[-20px] md:left-10 p-4 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl border border-outline-variant card-shadow hidden sm:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-fixed border border-primary-fixed-dim rounded-lg flex items-center justify-center">
                  <MaterialIcon name="star" size={20} className="text-primary" filled />
                </div>
                <div>
                  <div className="text-[10px] text-on-surface-variant font-medium">Review Auto-Replied</div>
                  <div className="text-xs font-bold text-on-surface">5-Star Feedback Posted</div>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="absolute -bottom-px left-0 right-0 h-40 bg-gradient-to-t from-background via-background/80 to-transparent z-20" />
        </motion.div>
      </div>
    </section>
  );
}
