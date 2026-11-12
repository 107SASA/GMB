import type { Metadata } from 'next';
import { cmsMetadata } from "@/lib/cms/content";

// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("growth-partner");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default function GrowthPartnerLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-marketing">{children}</div>;
}
