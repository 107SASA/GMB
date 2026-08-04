import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/companyInfo";
import { bookDemoLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

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
            <MaterialIcon name="mail" size={20} className="text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-on-surface">Email</div>
              <a href={`mailto:${COMPANY.supportEmail}`} className="text-primary underline">
                {COMPANY.supportEmail}
              </a>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <MaterialIcon name="language" size={20} className="text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-on-surface">Website</div>
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
            <MaterialIcon name="location_on" size={20} className="text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-on-surface">Address</div>
              <p className="text-on-surface-variant">{COMPANY.address}</p>
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
          . We typically respond within 2 business days.
          {bookDemoOpensWhatsApp && (
            <>
              {" "}You can also{" "}
              <a
                href={bookDemoLink()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-whatsapp underline font-medium"
              >
                book a demo on WhatsApp
              </a>
              .
            </>
          )}
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
