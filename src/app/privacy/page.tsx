import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout, LegalSection } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/companyInfo";

export const metadata: Metadata = {
  title: "Privacy Policy | Growwmatic AI",
  description:
    "How Growwmatic AI collects, uses, stores, and protects your data, including Google Business Profile data accessed through the Google APIs.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={`This Privacy Policy explains how ${COMPANY.name} ("we", "us", "our") collects, uses, and protects information when you use our website and services at ${COMPANY.domain}.`}
    >
      <LegalSection heading="1. Information We Collect">
        <p>We collect the following categories of information:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Account information</strong> — your name, email address, phone number, and
            password (stored in hashed form) when you create an account.
          </li>
          <li>
            <strong>Business information</strong> — details about the businesses (workspaces) you
            add, such as business name, category, address, website, and Google Business Profile
            details.
          </li>
          <li>
            <strong>Google account data</strong> — when you connect your Google Business Profile,
            we access data through the Google APIs (see the dedicated section below).
          </li>
          <li>
            <strong>Payment information</strong> — subscription and billing details are processed
            by our payment provider, Razorpay. We do not store your full card details on our
            servers.
          </li>
          <li>
            <strong>Usage data</strong> — technical logs such as IP address, browser type, and
            actions taken within the application, used to operate and improve the service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. Google User Data & Google Business Profile">
        <p>
          Growwmatic AI's use and transfer of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            With your explicit consent, we request the{" "}
            <code className="text-sm bg-slate-100 px-1 rounded">business.manage</code> scope to
            read and manage your Google Business Profile on your behalf.
          </li>
          <li>
            We use this access only to provide the features you request — auditing your profile,
            fetching reviews and insights, and (when you enable it) publishing posts or review
            replies you have approved.
          </li>
          <li>
            We do not sell Google user data, and we do not use it for advertising or to train
            generalized AI/ML models.
          </li>
          <li>
            You can disconnect your Google account at any time from your workspace settings, or
            revoke access directly from your{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google Account permissions
            </a>{" "}
            page.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. How We Use Your Information">
        <p>We use the information we collect to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>provide, maintain, and improve the service;</li>
          <li>generate AI-powered audits, content, and analytics for your businesses;</li>
          <li>process subscriptions and send billing and service communications;</li>
          <li>respond to support requests; and</li>
          <li>detect, prevent, and address fraud, abuse, and security issues.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Sharing & Third-Party Services">
        <p>
          We share data only with service providers that help us operate, and only as needed. These
          include Google (Business Profile APIs), Razorpay (payments), and AI/content and email
          providers used to deliver features. We do not sell your personal information.
        </p>
      </LegalSection>

      <LegalSection heading="5. Data Retention & Security">
        <p>
          We retain your information for as long as your account is active or as needed to provide
          the service and comply with legal obligations. We apply reasonable technical and
          organizational measures to protect your data, including encryption of sensitive tokens.
          No method of transmission or storage is completely secure, and we cannot guarantee
          absolute security.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your Rights">
        <p>
          You may access, correct, or delete your account data, and you may request deletion of
          your account entirely from within the app or by contacting us. Deleting your account
          removes your business data and revokes connected integrations.
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact Us">
        <p>
          For any privacy questions or requests, contact us at{" "}
          <a href={`mailto:${COMPANY.supportEmail}`} className="text-primary underline">
            {COMPANY.supportEmail}
          </a>{" "}
          or via our{" "}
          <Link href="/contact" className="text-primary underline">
            Contact page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
