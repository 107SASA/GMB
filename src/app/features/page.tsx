import type { Metadata } from "next";
import { sharedOpenGraph } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/lib/seoSchemas";
import { FeaturesPage } from "@/components/pages/FeaturesPage";

export const metadata: Metadata = {
  title: "Features — AI Google Business Profile Management",
  description:
    "Everything included in Growwmatics AI: AI Google Business Profile audits, AI content generation, review automation, CRM, and analytics — see the full feature list.",
  keywords: ["Growwmatics AI features", "Google Business Profile automation", "review automation", "AI GBP audit"],
  alternates: { canonical: "/features" },
  openGraph: {
    ...sharedOpenGraph,
    title: "Features — AI Google Business Profile Management | Growwmatics AI",
    description: "Everything included in Growwmatics AI's Google Business Profile growth platform.",
    url: "/features",
    type: "website",
  },
};

export default function Page() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Features", path: "/features" },
        ])}
      />
      <FeaturesPage />
    </>
  );
}
