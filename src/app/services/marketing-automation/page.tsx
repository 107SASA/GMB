import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { serviceSchema, faqPageSchema, breadcrumbSchema } from "@/lib/seoSchemas";
import { getServiceBySlug } from "@/lib/servicesData";
import { ServicePageTemplate } from "@/components/services/ServicePageTemplate";

const SLUG = "marketing-automation";
const service = getServiceBySlug(SLUG);
if (!service) throw new Error(`servicesData missing entry for slug "${SLUG}"`);

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  keywords: service.keywords,
  alternates: { canonical: `/services/${service.slug}` },
  openGraph: {
    title: service.metaTitle,
    description: service.metaDescription,
    url: `/services/${service.slug}`,
    type: "website",
  },
};

export default function MarketingAutomationServicePage() {
  if (!service) return notFound();
  return (
    <>
      <JsonLd data={serviceSchema(service)} />
      <JsonLd data={faqPageSchema(service.faqs)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "OnDemand Service", path: "/services" },
          { name: service.name, path: `/services/${service.slug}` },
        ])}
      />
      <ServicePageTemplate service={service} />
    </>
  );
}
