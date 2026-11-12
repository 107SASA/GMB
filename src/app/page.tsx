import type { Metadata } from "next";
import { cmsMetadata, cmsFaqs } from "@/lib/cms/content";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { HomeSplitExperience } from "@/components/sections/HomeSplitExperience";
import { BusinessNiches } from "@/components/sections/BusinessNiches";
import { GbpReportBanner } from "@/components/sections/GbpReportBanner";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/SocialProof";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema } from "@/lib/seoSchemas";

// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("home");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Growwmatics AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI-powered Google Business Profile automation — audits, content generation, review management, and lead conversion for local businesses.",
  url: "https://growwmatics.com",
};

export default async function Home() {
  const faqs = await cmsFaqs("home");
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <JsonLd data={softwareApplicationSchema} />
      {/* The FAQ section below, marked up so Google can show it as rich results. */}
      <JsonLd data={faqPageSchema(faqs)} />
      <Navbar />

      <HomeSplitExperience />
      <BusinessNiches />
      <GbpReportBanner />
      <FAQ faqs={faqs} />
      <FinalCTA />

      <Footer />
    </main>
  );
}
