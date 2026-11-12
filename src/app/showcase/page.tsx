import type { Metadata } from "next";
import { cmsMetadata } from "@/lib/cms/content";
import { ShowcasePage } from "@/components/pages/ShowcasePage";

// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("showcase");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default function Page() {
  return <ShowcasePage />;
}
