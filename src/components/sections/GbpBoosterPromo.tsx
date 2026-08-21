"use client";

import Link from "next/link";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";

/**
 * Sticky GBP Booster promo — Grexa-style full-width 2-row bar on mobile,
 * floating card on sm+.
 */
export function GbpBoosterPromo() {
  const whatsappHref = boostProfileLink();
  const whatsappExternal = bookDemoOpensWhatsApp;

  return (
    <div
      id="gbp-booster-bar"
      className="fixed z-40 bottom-0 inset-x-0 sm:bottom-6 sm:right-6 sm:left-auto sm:inset-x-auto sm:w-[min(392px,calc(100vw-2rem))] flex flex-col overflow-hidden rounded-none sm:rounded-lg shadow-[0_-2px_4px_rgba(0,0,0,0.25)] sm:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] bg-[#f0fff5] gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      role="complementary"
      aria-label="AI Google Business Profile Booster"
    >
      <div className="flex w-full h-8 gap-2 px-4 items-center bg-[#06b34a]">
        <span className="shrink-0 px-2 py-0.5 rounded bg-white text-[12px] font-semibold uppercase tracking-wide text-[#06b34a]">
          Free
        </span>
        <div className="flex flex-1 items-center justify-between min-w-0 gap-2">
          <p className="text-sm font-medium text-white truncate">
            AI Google Business Profile Booster
          </p>
          <Link
            href="/gbp-booster"
            className="shrink-0 text-[12px] underline whitespace-nowrap text-white hover:opacity-90"
          >
            Details
          </Link>
        </div>
      </div>

      <div className="flex flex-row w-full px-4 items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[17px] sm:text-lg leading-[22px] font-bold text-[#008f3c]">
          Get more Leads &amp; Customers from Google
        </p>
        <a
          href={whatsappHref}
          {...(whatsappExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="inline-flex items-center justify-center gap-1.5 shrink-0 w-[145px] h-10 rounded-lg bg-[#06b34a] hover:bg-[#059640] text-white text-[12px] sm:text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#06b34a] focus-visible:ring-offset-2"
        >
          <WhatsAppIcon size={18} />
          Try on WhatsApp
        </a>
      </div>
    </div>
  );
}
