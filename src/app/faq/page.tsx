import type { Metadata } from "next";
import { cmsMetadata, cmsFaqs } from "@/lib/cms/content";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seoSchemas";
import { FaqPage } from "@/components/pages/FaqPage";

// Text editable in Content Studio → Website pages (defaults: src/lib/cms/pages.ts).
export async function generateMetadata(): Promise<Metadata> {
  return cmsMetadata("faq");
}

// Rebuilt the moment a Content Studio change is approved; hourly as a safety
// net (e.g. if the database was unreachable while building).
export const revalidate = 3600;

export default async function Page() {
  // Home page questions first, then the FAQ-page-only ones — both editable in Content Studio.
  const [home, extra] = await Promise.all([cmsFaqs("home"), cmsFaqs("faq")]);
  const faqs = [...home, ...extra];
  return (
    <>
      <JsonLd data={faqPageSchema(faqs)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ])}
      />
      <FaqPage faqs={faqs} />
    </>
  );
}
