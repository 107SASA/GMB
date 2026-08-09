/**
 * General product FAQs — shared by the homepage FAQ teaser and the
 * standalone /faq page so the copy only lives in one place. Service-specific
 * FAQs live in servicesData.ts instead, so they don't duplicate/cannibalize
 * these for SEO purposes.
 */
export interface FaqEntry {
  question: string;
  answer: string;
}

export const HOMEPAGE_FAQS: FaqEntry[] = [
  {
    question: "How does AI optimize my Google Business Profile?",
    answer:
      "Our AI analyzes your current profile against thousands of high-ranking competitors in your niche. It identifies missing keywords, optimizes business categories, suggests better service descriptions, and generates localized posts to boost your authority.",
  },
  {
    question: "Can I manage multiple businesses?",
    answer:
      "Yes. You can add multiple business workspaces from a single account and switch between them in one dashboard. Each workspace runs on its own subscription, so you only pay for the businesses you're actively growing.",
  },
  {
    question: "Is manual approval available before posting?",
    answer:
      "Yes, you have full control. You can set the AI to 'Draft Mode' where it generates content for your review, or 'Auto-Pilot' where it posts automatically once it understands your brand voice.",
  },
  {
    question: "Does it work for coaching institutes?",
    answer:
      "Yes, it works for any local business that relies on Google Maps visibility, including coaching institutes, dental clinics, restaurants, and professional services.",
  },
];

/** Extra FAQs shown only on the standalone /faq page — not on the homepage teaser. */
export const ADDITIONAL_FAQS: FaqEntry[] = [
  {
    question: "Is there a free trial?",
    answer:
      "There's no separate paid free trial — every new business gets one free Google Business Profile audit/report to try the platform before subscribing, no credit card required.",
  },
  {
    question: "What does the free report include?",
    answer:
      "A profile completeness score, a review summary, your business category, and a comparison against nearby competitors — all based on your business's public Google listing.",
  },
  {
    question: "Do I need to connect WhatsApp to use the platform?",
    answer:
      "Review request campaigns, review reminders, and the WhatsApp sales/booking agents run through a connected WhatsApp Business number. Profile audits and content generation work independently of that connection.",
  },
  {
    question: "What happens after my free audit?",
    answer:
      "You can keep using the audit results as-is, or subscribe to unlock full automation — posting, review management, CRM, and the WhatsApp agents — for that business workspace.",
  },
];

export const ALL_FAQS: FaqEntry[] = [...HOMEPAGE_FAQS, ...ADDITIONAL_FAQS];
