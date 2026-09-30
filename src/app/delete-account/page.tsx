import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout, LegalSection } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/companyInfo";

/**
 * Public account-deletion page (no login) — the "Delete account URL" on the
 * Google Play listing. Every statement here must match what the code does:
 *   - Profile → Danger Zone → api/user/delete-account (immediate effects)
 *   - services/account/hardPurge.ts + accountHardPurgeCron (erasure after
 *     PURGE_GRACE_DAYS; billing kept BILLING_RETENTION_YEARS without personal data)
 * Change them together.
 */

export const metadata: Metadata = {
  title: "Delete Your Account",
  description: `How to delete your ${COMPANY.name} account and what happens to your data.`,
  alternates: { canonical: "/delete-account" },
};

const GRACE_DAYS = 30; // PURGE_GRACE_DAYS in services/account/purgePlan.ts
const BILLING_YEARS = 8; // BILLING_RETENTION_YEARS in services/account/purgePlan.ts

export default function DeleteAccountPage() {
  return (
    <LegalLayout
      title="Delete Your Account"
      intro={`How to delete your ${COMPANY.name} account (the ${COMPANY.name} website and Android app, developed by ${COMPANY.legalName}) and what happens to your data.`}
    >
      <LegalSection heading="How to delete your account">
        <ol className="list-decimal pl-6 space-y-2">
          <li>
            Sign in to your {COMPANY.name} dashboard at{" "}
            <Link href="/login" className="text-primary underline">
              {COMPANY.domain}/login
            </Link>{" "}
            with the account you want to delete.
          </li>
          <li>
            Open <strong>Profile</strong> from the sidebar and scroll to the <strong>Danger Zone</strong>.
          </li>
          <li>
            Click <strong>Delete My Account</strong>, type your account email address to confirm, and click{" "}
            <strong>Delete Account</strong>.
          </li>
        </ol>
        <p>
          Account deletion is done from the website. The Android app uses the same account — deleting it on the website
          signs you out of the app as well.
        </p>
      </LegalSection>

      <LegalSection heading="Can't sign in?">
        <p>
          Email{" "}
          <a href={`mailto:${COMPANY.supportEmail}?subject=Account%20deletion%20request`} className="text-primary underline">
            {COMPANY.supportEmail}
          </a>{" "}
          from the email address registered on your account, with the subject &quot;Account deletion request&quot;. We may
          ask you to confirm you own the account before deleting it.
        </p>
      </LegalSection>

      <LegalSection heading="What happens immediately">
        <ul className="list-disc pl-6 space-y-2">
          <li>You are signed out on every device and can no longer sign in to the account.</li>
          <li>Your account and businesses no longer appear in {COMPANY.name}.</li>
          <li>Your email address and phone number are released, so you can sign up again later if you wish.</li>
          <li>Any paid subscription is cancelled, so you are not charged again.</li>
          <li>{COMPANY.name}&apos;s access to your Google Business Profile is revoked.</li>
        </ul>
      </LegalSection>

      <LegalSection heading={`What is permanently erased after ${GRACE_DAYS} days`}>
        <p>
          {GRACE_DAYS} days after you delete your account, we permanently erase your personal data and your businesses&apos;
          data, including:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Your name, email address, phone number, password and app settings.</li>
          <li>Business profile details, uploaded photos, videos and generated images.</li>
          <li>Leads, customers, WhatsApp conversations, appointments and review requests.</li>
          <li>Synced Google reviews, reply drafts, posts, audits, reports and SEO plans.</li>
          <li>Google connection data, notifications and usage logs.</li>
        </ul>
        <p>
          During those {GRACE_DAYS} days the data is kept deactivated and inaccessible, so an account deleted by mistake can
          still be recovered — contact {COMPANY.supportEmail} as soon as possible. After {GRACE_DAYS} days it cannot be
          recovered.
        </p>
      </LegalSection>

      <LegalSection heading="What we keep">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Billing records</strong> — subscription plan, dates, amounts and payment references — are kept for up to{" "}
            {BILLING_YEARS} years as required for tax and accounting, without your name, email or phone number. They are then
            deleted.
          </li>
          <li>
            A record that the deletion was carried out (an internal account id and the number of items erased — no personal
            details).
          </li>
        </ul>
        <p>
          Payments are processed by Razorpay, which keeps its own transaction records under its own policy.
        </p>
      </LegalSection>

      <LegalSection heading="More information">
        <p>
          See our{" "}
          <Link href="/privacy" className="text-primary underline">
            Privacy Policy
          </Link>{" "}
          or{" "}
          <Link href="/contact" className="text-primary underline">
            contact us
          </Link>{" "}
          with any questions.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
