import type { Metadata } from "next";

// pricing/page.tsx is a Client Component ('use client', live Razorpay
// checkout state) so it can't export `metadata` itself — a layout.tsx in the
// same segment can, independently, without touching that page's logic.
// Before this file existed, /pricing had NO page-specific metadata at all
// and silently inherited the root layout's generic "GrowwMatics AI" title/
// description — identical to the homepage's, in Google's eyes.
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, single-plan pricing for GrowwMatics AI — Google Business Profile automation, AI content, review management, and CRM, all included.",
  keywords: ["GrowwMatics AI pricing", "Google Business Profile pricing", "local SEO software pricing"],
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing | GrowwMatics AI",
    description: "Simple, single-plan pricing for GrowwMatics AI.",
    url: "/pricing",
    type: "website",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
