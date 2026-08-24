import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { HomeSplitExperience } from "@/components/sections/HomeSplitExperience";
import { BusinessNiches } from "@/components/sections/BusinessNiches";
import { GbpReportBanner } from "@/components/sections/GbpReportBanner";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/SocialProof";
import { JsonLd } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "GrowwMatics AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI-powered Google Business Profile automation — audits, content generation, review management, and lead conversion for local businesses.",
  url: "https://growwmatics.com",
};

export default function Home() {
  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <JsonLd data={softwareApplicationSchema} />
      <Navbar />

      <HomeSplitExperience />
      <BusinessNiches />
      <GbpReportBanner />
      <FAQ />
      <FinalCTA />

      <Footer />
    </main>
  );
}
