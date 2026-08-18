import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { ProductShowcase } from "@/components/sections/ProductShowcase";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/SocialProof";
import { JsonLd } from "@/components/seo/JsonLd";

// Root layout's metadata (title/description/OG) already covers the
// homepage reasonably well as the site-wide default — this just adds the
// one thing that default was missing: an explicit self-referencing
// canonical, so Google has no ambiguity about "/" being the canonical URL
// (vs. a tracking-param or trailing-slash variant of the same page).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// SoftwareApplication, not just Organization (that one's in the root layout,
// site-wide) — this is what makes the homepage itself eligible for a rich
// result describing the product, not just the brand.
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
    <main className="theme-marketing min-h-screen bg-background selection:bg-primary-fixed">
      <JsonLd data={softwareApplicationSchema} />
      <Navbar />

      <Hero />

      <Features />

      <HowItWorks />

      <ProductShowcase />

      <Pricing />

      <FAQ />

      <FinalCTA />

      <Footer />
    </main>
  );
}
