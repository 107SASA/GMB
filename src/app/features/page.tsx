import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/lib/seoSchemas";
import { FeaturesPage } from "@/components/pages/FeaturesPage";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything included in GrowwMatics AI: AI Google Business Profile audits, AI content generation, review automation, CRM, and analytics — see the full feature list.",
  keywords: ["GrowwMatics AI features", "Google Business Profile automation", "review automation", "AI GBP audit"],
  alternates: { canonical: "/features" },
  openGraph: {
    title: "Features | GrowwMatics AI",
    description: "Everything included in GrowwMatics AI's Google Business Profile growth platform.",
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
