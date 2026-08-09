import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/lib/seoSchemas";
import { COMPANY } from "@/lib/companyInfo";
import { SERVICES } from "@/lib/servicesData";
import { ServicesHub } from "@/components/services/ServicesHub";

export const metadata: Metadata = {
  title: "OnDemand Service",
  description:
    "SEO, Performance Marketing, Marketing Automation, Process Implementation and Business Consultation for local businesses — all built around your Google Business Profile.",
  keywords: [
    "OnDemand Service",
    "local business services",
    "Google Business Profile services",
    "SEO",
    "performance marketing",
    "marketing automation",
    "process implementation",
    "business consultation",
  ],
  alternates: { canonical: "/services" },
  openGraph: {
    title: "OnDemand Service | GrowwMatics AI",
    description:
      "SEO, Performance Marketing, Marketing Automation, Process Implementation and Business Consultation for local businesses.",
    url: "/services",
    type: "website",
  },
};

const itemListSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: SERVICES.map((s, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: s.name,
    url: `${COMPANY.siteUrl}/services/${s.slug}`,
  })),
};

export default function ServicesPage() {
  return (
    <>
      <JsonLd data={itemListSchema} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "OnDemand Service", path: "/services" },
        ])}
      />
      <ServicesHub />
    </>
  );
}
