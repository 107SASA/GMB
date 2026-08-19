"use client";

import Link from "next/link";

interface BookDemoButtonProps {
  /** Which page/CTA triggered this — passed through as ?origin= on /book-demo
   *  so the CRM shows where each demo request came from (e.g. "navbar",
   *  "hero", "service:seo"). */
  origin: string;
  className?: string;
  children: React.ReactNode;
  /** Fires alongside navigating — e.g. closing a mobile nav drawer the
   *  trigger button lives inside. */
  onTriggerClick?: () => void;
}

/**
 * Shared trigger for the "Book a Demo" / "Book a Free Consultant" CTA used
 * everywhere on the marketing site (Navbar, Hero, every service page). Was a
 * popup modal (name + WhatsApp, 2 fields) until the Aug 2026 redesign moved
 * that form to its own page — see src/app/book-demo/page.tsx — with the same
 * name+WhatsApp+budget fields as the reference design, plus a business-search
 * field. This component is now just a Link with the old call sites' prop
 * shape preserved so none of them needed to change.
 */
export function BookDemoButton({ origin, className, children, onTriggerClick }: BookDemoButtonProps) {
  return (
    <Link
      href={`/book-demo?origin=${encodeURIComponent(origin)}`}
      className={className}
      onClick={onTriggerClick}
    >
      {children}
    </Link>
  );
}
