import type { Metadata } from "next";
import { cmsMetadata, cmsFaqs } from "@/lib/cms/content";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { serviceSchema, faqPageSchema, breadcrumbSchema } from "@/lib/seoSchemas";
import { getServiceBySlug } from "@/lib/servicesData";
import { ServicePageTemplate } from "@/components/services/ServicePageTemplate";

const SLUG = "business-consultation";
const service = getServiceBySlug(SLUG);
if (!service) throw new Error(`servicesData missing entry for slug "${SLUG}"`);

export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata(`service-${SLUG}`);
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default async function BusinessConsultationServicePage() {
  if (!service) return notFound();
  // FAQs are editable in Content Studio → Website pages.
  const faqs = await cmsFaqs(`service-${SLUG}`);
  return (
    <>
      <JsonLd data={serviceSchema(service)} />
      <JsonLd data={faqPageSchema(faqs)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "OnDemand Service", path: "/services" },
          { name: service.name, path: `/services/${service.slug}` },
        ])}
      />
      <ServicePageTemplate service={{ ...service, faqs }} />
    </>
  );
}
