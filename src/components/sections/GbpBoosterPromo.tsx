"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

/**
 * Sticky GBP Booster promo — full-width bar on mobile (unchanged: it has
 * dedicated page-bottom clearance via .theme-marketing's padding-bottom),
 * but on sm+ it now starts as a small collapsed launcher pill instead of an
 * always-expanded ~392px card. The expanded card was covering hero panels
 * and CTA cards on ordinary laptop viewport heights (900px and below) from
 * first paint — not just after scrolling past it — which read as broken UI
 * rather than a helpful widget. Expand/collapse on click; same links, same
 * behavior, just not permanently occupying that much of the viewport.
 */
export function GbpBoosterPromo() {
  const whatsappHref = boostProfileLink();
  const whatsappExternal = bookDemoOpensWhatsApp;
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {/* Mobile: unchanged full-width bar, always visible */}
      <div
        id="gbp-booster-bar-mobile"
        className="theme-marketing sm:hidden fixed z-40 bottom-0 inset-x-0 flex flex-col overflow-hidden rounded-t-xl border border-(--mkt-line) shadow-[0_-4px_16px_rgba(15,23,20,0.08)] bg-white gap-3 pt-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
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
          <Link
            href="/gbp-booster"
            className="shrink-0 mkt-label text-[#006e2c] hover:underline whitespace-nowrap"
          >
            Details
          </Link>
        </div>

        <div className="flex flex-row w-full items-center justify-between gap-3">
          <p className="min-w-0 flex-1 font-mkt-display text-base leading-snug font-semibold text-[#101613]">
            Get more leads &amp; customers from Google
          </p>
          <a
            href={whatsappHref}
            {...(whatsappExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="inline-flex items-center justify-center gap-1.5 shrink-0 w-[145px] h-10 rounded-md bg-[#006e2c] hover:bg-[#005a24] text-white text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006e2c] focus-visible:ring-offset-2"
          >
            <WhatsAppIcon size={18} />
            Try on WhatsApp
          </a>
        </div>
      </div>

      {/* Desktop: collapsed launcher pill by default, expands on click */}
      <div className="theme-marketing hidden sm:block fixed z-40 bottom-6 right-6">
        <AnimatePresence mode="wait" initial={false}>
          {expanded ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="w-[min(360px,calc(100vw-3rem))] flex flex-col overflow-hidden rounded-xl border border-(--mkt-line) shadow-card bg-white gap-3 pt-3 px-4 pb-4"
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
    </>
  );
}
