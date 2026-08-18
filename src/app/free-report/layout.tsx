import type { Metadata } from "next";

// free-report/page.tsx is a Client Component ('use client', autocomplete +
// form state) so it can't export `metadata` itself — see pricing/layout.tsx
// for why a layout.tsx here fixes that without touching the page's logic.
// This is one of the highest-intent pages on the whole site (the main lead
// magnet) and previously had no page-specific title/description at all.
export const metadata: Metadata = {
  title: "Free Google Business Profile Report",
  description:
    "Get a free report on your Google Business Profile — review score, profile completion, category, and a competitor comparison. No credit card required.",
  keywords: [
    "free Google Business Profile report",
    "free GBP audit",
    "Google Maps ranking check",
    "local SEO audit",
  ],
  alternates: { canonical: "/free-report" },
  openGraph: {
    title: "Get Your Free Google Business Profile Report | GrowwMatics AI",
    description:
      "See your review score, profile completion, and competitor comparison — free, in minutes.",
    url: "/free-report",
    type: "website",
  },
};

export default function FreeReportLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-marketing">{children}</div>;
}
