import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout, LegalSection } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/companyInfo";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | GrowwMatics AI",
  description:
    "How subscription cancellations and refunds work for GrowwMatics AI.",
};

export default function RefundPage() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      intro={`This policy explains how cancellations and refunds work for ${COMPANY.name} subscriptions.`}
    >
      <LegalSection heading="1. Subscriptions">
        <p>
          {COMPANY.name} is offered on a recurring monthly subscription basis, billed through
          Razorpay. Each business workspace is billed on its own subscription. Before subscribing,
          you can run a free Google Business Profile audit for each new workspace so you can evaluate
          the product.
        </p>
      </LegalSection>

      <LegalSection heading="2. Cancellation">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            You can cancel a workspace's subscription at any time from your billing dashboard.
          </li>
          <li>
            Cancellation stops future renewals. Your access to that workspace continues until the
            end of the current paid billing period, after which the workspace's dashboard is locked
            again.
          </li>
          <li>There are no long-term contracts or cancellation fees.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Refunds">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Subscription fees are generally non-refundable once a billing period has started,
            because you retain access for the full period you paid for.
          </li>
          <li>
            If you were charged in error, or experienced a technical failure that prevented you from
            using the service and we were unable to resolve it, contact us within 7 days of the
            charge and we will review your request in good faith.
          </li>
          <li>
            Approved refunds are processed back to the original payment method via Razorpay, and may
            take 5–10 business days to reflect depending on your bank.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. How to Request a Refund">
        <p>
          Email{" "}
          <a href={`mailto:${COMPANY.supportEmail}`} className="text-primary underline">
            {COMPANY.supportEmail}
          </a>{" "}
          from your registered email address with your account details and the reason for the
          request, or reach us through our{" "}
          <Link href="/contact" className="text-primary underline">
            Contact page
          </Link>
          . We aim to respond within 2 business days.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
