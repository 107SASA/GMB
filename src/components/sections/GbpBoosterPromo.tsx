"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

/**
 * Sticky GBP Booster promo — a small collapsed launcher pill by default at
 * every breakpoint (mobile included, since Aug 2026), expanding into the
 * full card on click. Mobile used to always show the full-width expanded
 * bar permanently docked at the bottom of the screen; that covered content
 * from first paint (not just after scrolling to it) and looked like broken
 * UI rather than a helpful widget — same problem the desktop version had
 * before its own collapsed-pill redesign. Same links/behavior either way,
 * just not permanently occupying viewport space until the visitor asks for
 * it.
 */
export function GbpBoosterPromo() {
  const whatsappHref = boostProfileLink();
  const whatsappExternal = bookDemoOpensWhatsApp;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="theme-marketing fixed z-40 bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6"
    >
      <AnimatePresence mode="wait" initial={false}>
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="w-[min(360px,calc(100vw-2rem))] flex flex-col overflow-hidden rounded-xl border border-(--mkt-line) shadow-card bg-white gap-3 pt-3 px-4 pb-4"
            role="complementary"
            aria-label="AI Google Business Profile Booster"
          >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="mkt-label shrink-0 px-2 py-1 rounded-md bg-[#e8f8ee] text-[#006e2c]">
                    Free
                  </span>
                  <p className="text-xs font-medium text-[#3d4a3d] truncate">
                    AI Google Business Profile Booster
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Collapse"
                  className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[#6b756f] hover:bg-(--mkt-surface) hover:text-[#101613] transition-colors"
                >
                  <MaterialIcon name="close" size={16} />
                </button>
              </div>

              <p className="font-mkt-display text-lg leading-snug font-semibold text-[#101613]">
                Get more leads &amp; customers from Google
              </p>

              <div className="flex items-center gap-2">
                <a
                  href={whatsappHref}
                  {...(whatsappExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="inline-flex items-center justify-center gap-1.5 flex-1 h-10 rounded-md bg-[#006e2c] hover:bg-[#005a24] text-white text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006e2c] focus-visible:ring-offset-2"
                >
                  <WhatsAppIcon size={16} />
                  Try on WhatsApp
                </a>
                <Link
                  href="/gbp-booster"
                  className="shrink-0 mkt-label text-[#006e2c] hover:underline whitespace-nowrap px-1"
                >
                  Details
                </Link>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="collapsed"
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              onClick={() => setExpanded(true)}
              className="flex items-center gap-2 pl-3 pr-4 h-12 rounded-full border border-(--mkt-line) shadow-card bg-white hover:border-[#006e2c] transition-colors"
              aria-label="Open: free AI Google Business Profile booster"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#006e2c]" />
              </span>
              <WhatsAppIcon size={16} className="text-[#006e2c] shrink-0" />
              <span className="text-sm font-semibold text-[#101613] whitespace-nowrap">Free GBP Booster</span>
            </motion.button>
          )}
      </AnimatePresence>
    </div>
  );
}
