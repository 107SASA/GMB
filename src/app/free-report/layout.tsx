import type { Metadata } from "next";
import { cmsMetadata } from "@/lib/cms/content";

// free-report/page.tsx is a Client Component ('use client', autocomplete +
// form state) so it can't export `metadata` itself — see pricing/layout.tsx
// for why a layout.tsx here fixes that without touching the page's logic.
// This is one of the highest-intent pages on the whole site (the main lead
// magnet) and previously had no page-specific title/description at all.
// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("free-report");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default function FreeReportLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-marketing">{children}</div>;
}
