import type { Metadata } from "next";
import { cmsMetadata } from "@/lib/cms/content";

// book-demo/page.tsx is a Client Component ('use client', form state +
// useSearchParams) so it can't export `metadata` itself — see
// free-report/layout.tsx for why a layout.tsx here fixes that without
// touching the page's logic.
// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("book-demo");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-marketing">{children}</div>;
}
