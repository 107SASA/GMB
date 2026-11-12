import type { Metadata } from "next";
import { cmsMetadata } from "@/lib/cms/content";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/lib/seoSchemas";
import { COMPANY } from "@/lib/companyInfo";
import { SERVICES } from "@/lib/servicesData";
import { ServicesHub } from "@/components/services/ServicesHub";

// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("services");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

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
