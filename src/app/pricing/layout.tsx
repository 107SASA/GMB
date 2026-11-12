import type { Metadata } from "next";
import { cmsMetadata } from "@/lib/cms/content";

// pricing/page.tsx is a Client Component ('use client', live Razorpay
// checkout state) so it can't export `metadata` itself — a layout.tsx in the
// same segment can, independently, without touching that page's logic.
// Before this file existed, /pricing had NO page-specific metadata at all
// and silently inherited the root layout's generic "GrowwMatics AI" title/
// description — identical to the homepage's, in Google's eyes.
// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("pricing");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
