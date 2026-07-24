import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Globe, MapPin } from "lucide-react";
import { LegalLayout, LegalSection } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/companyInfo";

export const metadata: Metadata = {
  title: "Contact Us | GrowwMatics AI",
  description: "Get in touch with the GrowwMatics AI team.",
};

export default function ContactPage() {
  return (
    <LegalLayout
      title="Contact Us"
      intro="We'd love to hear from you. Reach out with any questions about the product, your subscription, or support."
    >
      <LegalSection heading="Get in touch">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">Email</div>
              <a href={`mailto:${COMPANY.supportEmail}`} className="text-primary underline">
                {COMPANY.supportEmail}
              </a>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">Website</div>
              <a
                href={COMPANY.siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {COMPANY.domain}
              </a>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">Address</div>
              <p className="text-slate-600">{COMPANY.address}</p>
            </div>
          </div>
        </div>
      </LegalSection>

      <LegalSection heading="Support">
        <p>
          For account, billing, or technical help, email{" "}
          <a href={`mailto:${COMPANY.supportEmail}`} className="text-primary underline">
            {COMPANY.supportEmail}
          </a>
          . We typically respond within 2 business days. You can also request a walkthrough via our{" "}
          <Link href="/book-demo" className="text-primary underline">
            demo booking page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
