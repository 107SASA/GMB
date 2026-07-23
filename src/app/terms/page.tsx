import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout, LegalSection } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/companyInfo";

export const metadata: Metadata = {
  title: "Terms & Conditions | Growwmatic AI",
  description:
    "The terms governing your use of the Growwmatic AI website and services.",
};

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms & Conditions"
      intro={`These Terms & Conditions govern your access to and use of the ${COMPANY.name} website and services at ${COMPANY.domain}. By creating an account or using the service, you agree to these terms.`}
    >
      <LegalSection heading="1. The Service">
        <p>
          {COMPANY.name} provides an AI-powered platform for local business growth, including Google
          Business Profile auditing and optimization, AI content generation and scheduling, review
          management, and a CRM for lead tracking. Features available to you depend on your active
          subscription.
        </p>
      </LegalSection>

      <LegalSection heading="2. Accounts & Workspaces">
        <ul className="list-disc pl-6 space-y-2">
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>
            You may add multiple business workspaces to a single account. Each workspace requires
            its own active subscription to access the full dashboard; see our{" "}
            <Link href="/refund" className="text-primary underline">
              Refund &amp; Cancellation Policy
            </Link>
            .
          </li>
          <li>
            You must provide accurate information and only connect Google Business Profiles that you
            own or are authorized to manage.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Subscriptions & Billing">
        <p>
          Paid features are billed on a recurring subscription basis through our payment provider,
          Razorpay. Prices are shown at checkout. Subscriptions renew automatically until cancelled.
          You can cancel at any time from your billing dashboard; cancellation stops future renewals
          as described in our Refund &amp; Cancellation Policy.
        </p>
      </LegalSection>

      <LegalSection heading="4. Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>use the service for any unlawful, misleading, or fraudulent purpose;</li>
          <li>violate Google's or any third party's terms, policies, or intellectual property;</li>
          <li>attempt to disrupt, reverse-engineer, or gain unauthorized access to the service; or</li>
          <li>publish content through the platform that is unlawful, deceptive, or harmful.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. AI-Generated Content">
        <p>
          The platform uses AI to generate audits, posts, replies, and suggestions. You are
          responsible for reviewing AI-generated content before it is published to your Google
          Business Profile or sent to customers. We do not guarantee specific rankings, results, or
          outcomes.
        </p>
      </LegalSection>

      <LegalSection heading="6. Intellectual Property">
        <p>
          The service, including its software and design, is owned by {COMPANY.name}. Content you
          provide remains yours; you grant us the limited rights needed to operate the service on
          your behalf.
        </p>
      </LegalSection>

      <LegalSection heading="7. Disclaimers & Limitation of Liability">
        <p>
          The service is provided "as is" without warranties of any kind. To the maximum extent
          permitted by law, {COMPANY.name} is not liable for any indirect, incidental, or
          consequential damages, or for any loss of profits, data, or goodwill arising from your use
          of the service.
        </p>
      </LegalSection>

      <LegalSection heading="8. Termination">
        <p>
          We may suspend or terminate access if these terms are violated. You may stop using the
          service and delete your account at any time.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to These Terms">
        <p>
          We may update these terms from time to time. Continued use of the service after changes
          take effect constitutes acceptance of the revised terms.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact">
        <p>
          Questions about these terms? Email{" "}
          <a href={`mailto:${COMPANY.supportEmail}`} className="text-primary underline">
            {COMPANY.supportEmail}
          </a>{" "}
          or visit our{" "}
          <Link href="/contact" className="text-primary underline">
            Contact page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
