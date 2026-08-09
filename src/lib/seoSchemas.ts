import { COMPANY } from "./companyInfo";
import type { ServiceDefinition } from "./servicesData";

/** schema.org Service — one service page. */
export function serviceSchema(service: ServiceDefinition) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.name,
    description: service.metaDescription,
    url: `${COMPANY.siteUrl}/services/${service.slug}`,
    provider: {
      "@type": "Organization",
      name: COMPANY.name,
      url: COMPANY.siteUrl,
    },
    areaServed: "IN",
    serviceType: service.name,
  };
}

/** schema.org FAQPage — reused for any faqs[] array (service pages, /faq). */
export function faqPageSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };
}

/** schema.org BreadcrumbList — Home > Services > <service>. */
export function breadcrumbSchema(
  items: { name: string; path: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${COMPANY.siteUrl}${item.path}`,
    })),
  };
}
