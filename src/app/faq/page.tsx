import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seoSchemas";
import { ALL_FAQS } from "@/lib/faqData";
import { FaqPage } from "@/components/pages/FaqPage";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers to common questions about Growwmatics AI — Google Business Profile automation, free reports, WhatsApp automation, pricing, and multi-location support.",
  keywords: ["Growwmatics AI FAQ", "Google Business Profile questions", "GBP automation FAQ"],
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ | Growwmatics AI",
    description: "Answers to common questions about Growwmatics AI.",
    url: "/faq",
    type: "website",
  },
};

export default function Page() {
  return (
    <>
      <JsonLd data={faqPageSchema(ALL_FAQS)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ])}
      />
      <FaqPage />
    </>
  );
}
