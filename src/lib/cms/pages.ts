import { SERVICES } from "@/lib/servicesData";
import { HOMEPAGE_FAQS, ADDITIONAL_FAQS, type FaqEntry } from "@/lib/faqData";

/**
 * Website pages the marketing team can edit in Content Studio → Website pages.
 *
 * The values here are the DEFAULTS — exactly what each page used before the
 * CMS existed. A page only changes when a Super Admin approves an edit (stored
 * in SitePageContent.live); any field left empty there falls back to these.
 *
 * `paths` = every URL that must be rebuilt when this page's content goes live.
 * Client-safe (no DB imports) so the Studio UI can show the defaults too.
 */
export interface CmsPageDef {
  key: string;
  /** Plain-language name the marketing team sees. */
  label: string;
  /** One line telling a non-technical editor what this page is. */
  help: string;
  path: string;
  group: "Main pages" | "Services" | "Sign-up & leads" | "Legal";
  /** Shown in Google as "<title> | Growwmatics AI" unless absoluteTitle. */
  title: string;
  absoluteTitle?: boolean;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  keywords?: string[];
  /** Built-in FAQ list, when the page shows FAQs the team may edit. */
  faqs?: FaqEntry[];
  /** Extra URLs to rebuild on publish (the page's own path is always included). */
  alsoRevalidate?: string[];
}

const servicePages: CmsPageDef[] = SERVICES.map((s) => ({
  key: `service-${s.slug}`,
  label: `Service: ${s.name}`,
  help: `The ${s.name} service page.`,
  path: `/services/${s.slug}`,
  group: "Services" as const,
  title: s.metaTitle,
  description: s.metaDescription,
  ogTitle: s.metaTitle,
  ogDescription: s.metaDescription,
  keywords: s.keywords,
  faqs: s.faqs,
}));

export const CMS_PAGES: CmsPageDef[] = [
  {
    key: "home",
    label: "Home page",
    help: "growwmatics.com — the first page most visitors see.",
    path: "/",
    group: "Main pages",
    title: "Growwmatics AI — Google Business Profile Management & Local SEO",
    absoluteTitle: true,
    description:
      "AI that runs your Google Business Profile: Google posts, review replies, more 5-star reviews and WhatsApp lead follow-up for local businesses in India. Free GBP report.",
    faqs: HOMEPAGE_FAQS,
    // The FAQ page repeats the homepage questions first.
    alsoRevalidate: ["/faq"],
  },
  {
    key: "about",
    label: "About us",
    help: "Who we are and why we built Growwmatics AI.",
    path: "/about",
    group: "Main pages",
    title: "About Us",
    description:
      "Growwmatics AI builds AI-powered tools that help local businesses win on Google — audits, content, reviews, and lead conversion in one platform.",
  },
  {
    key: "features",
    label: "Features",
    help: "The full list of what the product does.",
    path: "/features",
    group: "Main pages",
    title: "Features — AI Google Business Profile Management",
    description:
      "Everything included in Growwmatics AI: AI Google Business Profile audits, AI content generation, review automation, CRM, and analytics — see the full feature list.",
    ogTitle: "Features — AI Google Business Profile Management | Growwmatics AI",
    ogDescription: "Everything included in Growwmatics AI's Google Business Profile growth platform.",
    keywords: ["Growwmatics AI features", "Google Business Profile automation", "review automation", "AI GBP audit"],
  },
  {
    key: "pricing",
    label: "Pricing",
    help: "Our plan and price.",
    path: "/pricing",
    group: "Main pages",
    title: "Pricing — Google Business Profile Management Plan",
    description:
      "Simple, single-plan pricing for Growwmatics AI — Google Business Profile automation, AI content, review management, and CRM, all included.",
    ogTitle: "Pricing — Google Business Profile Management Plan | Growwmatics AI",
    ogDescription: "Simple, single-plan pricing for Growwmatics AI.",
    keywords: ["Growwmatics AI pricing", "Google Business Profile pricing", "local SEO software pricing"],
  },
  {
    key: "gbp-booster",
    label: "GMB Booster",
    help: "The Google Business Profile optimization landing page.",
    path: "/gbp-booster",
    group: "Main pages",
    title: "Google Business Profile Optimization (GMB Booster)",
    description:
      "Rank higher on Google with Growwmatics AI — profile analysis, review automation, and local SEO tips that get you more leads and customers.",
    ogTitle: "Google Business Profile Optimization (GMB Booster) | Growwmatics AI",
    ogDescription: "AI-powered Google Business Profile growth — audits, reviews, and ranking tips for local businesses.",
  },
  {
    key: "showcase",
    label: "Showcase",
    help: "Photos, videos and reviews from our customers.",
    path: "/showcase",
    group: "Main pages",
    title: "Showcase",
    description:
      "Real photos, video, and reviews shared by businesses on Growwmatics AI — reviewed and approved by our team before they're posted.",
  },
  {
    key: "faq",
    label: "FAQ page",
    help: "The full questions page. It shows the Home page questions first, then the questions you add here.",
    path: "/faq",
    group: "Main pages",
    title: "FAQ",
    description:
      "Answers to common questions about Growwmatics AI — Google Business Profile automation, free reports, WhatsApp automation, pricing, and multi-location support.",
    ogTitle: "FAQ | Growwmatics AI",
    ogDescription: "Answers to common questions about Growwmatics AI.",
    keywords: ["Growwmatics AI FAQ", "Google Business Profile questions", "GBP automation FAQ"],
    faqs: ADDITIONAL_FAQS,
  },
  {
    key: "app",
    label: "Mobile app",
    help: "The page that links to the mobile app.",
    path: "/app",
    group: "Main pages",
    title: "Get the App",
    description:
      "Download the Growwmatics AI mobile app to manage your Google Business Profile, reviews, content, and leads from your phone.",
  },
  {
    key: "contact",
    label: "Contact us",
    help: "How to reach the team.",
    path: "/contact",
    group: "Main pages",
    title: "Contact Us",
    description: "Get in touch with the Growwmatics AI team — questions about the product, your subscription, or support.",
  },
  {
    key: "services",
    label: "All services",
    help: "The page listing every service.",
    path: "/services",
    group: "Services",
    title: "Local SEO & Digital Marketing Services",
    description:
      "SEO, Performance Marketing, Marketing Automation, Process Implementation and Business Consultation for local businesses — all built around your Google Business Profile.",
    ogTitle: "Local SEO & Digital Marketing Services | Growwmatics AI",
    ogDescription:
      "SEO, Performance Marketing, Marketing Automation, Process Implementation and Business Consultation for local businesses.",
  },
  ...servicePages,
  {
    key: "free-report",
    label: "Free report",
    help: "Where businesses ask for their free Google Business Profile report — our main lead page.",
    path: "/free-report",
    group: "Sign-up & leads",
    title: "Free Google Business Profile Report",
    description:
      "Get a free report on your Google Business Profile — review score, profile completion, category, and a competitor comparison. No credit card required.",
    ogTitle: "Get Your Free Google Business Profile Report | Growwmatics AI",
    ogDescription: "See your review score, profile completion, and competitor comparison — free, in minutes.",
    keywords: ["free Google Business Profile report", "free GBP audit", "Google Maps ranking check", "local SEO audit"],
  },
  {
    key: "book-demo",
    label: "Book a demo",
    help: "The demo booking form.",
    path: "/book-demo",
    group: "Sign-up & leads",
    title: "Book a Free Demo",
    description:
      "See how Growwmatics AI can grow your Google Business Profile — book a free demo and we'll walk you through it on WhatsApp.",
    ogTitle: "Book a Free Demo | Growwmatics AI",
    ogDescription: "See how Growwmatics AI can grow your Google Business Profile.",
  },
  {
    key: "growth-partner",
    label: "Growth Partner program",
    help: "For agencies and freelancers who want to earn commission.",
    path: "/growth-partner",
    group: "Sign-up & leads",
    title: "Become a Growth Partner",
    description:
      "Agencies, freelancers and consultants: bring local businesses to Growwmatics AI and earn commission on their first payment and every renewal.",
    ogTitle: "Become a Growth Partner | Growwmatics AI",
    ogDescription: "Earn recurring commission for every business you bring to Growwmatics AI.",
  },
  {
    key: "growth-partner-apply",
    label: "Growth Partner application",
    help: "The partner application form.",
    path: "/growth-partner/apply",
    group: "Sign-up & leads",
    title: "Apply as a Growth Partner",
    description: "Apply to the Growwmatics AI Growth Partner Program: earn commission on every business you bring.",
  },
  {
    key: "privacy",
    label: "Privacy policy",
    help: "Legal page.",
    path: "/privacy",
    group: "Legal",
    title: "Privacy Policy",
    description:
      "How Growwmatics AI collects, uses, stores, and protects your data, including Google Business Profile data accessed through the Google APIs.",
  },
  {
    key: "terms",
    label: "Terms & conditions",
    help: "Legal page.",
    path: "/terms",
    group: "Legal",
    title: "Terms & Conditions",
    description: "The terms governing your use of the Growwmatics AI website and services.",
  },
  {
    key: "refund",
    label: "Refund policy",
    help: "Legal page.",
    path: "/refund",
    group: "Legal",
    title: "Refund & Cancellation Policy",
    description: "How subscription cancellations and refunds work for Growwmatics AI.",
  },
];

export const CMS_PAGE_GROUPS = ["Main pages", "Services", "Sign-up & leads", "Legal"] as const;

export function getCmsPage(key: string): CmsPageDef | undefined {
  return CMS_PAGES.find((p) => p.key === key);
}

/** How Google will show the title (the site name is added unless the title is absolute). */
export function fullSeoTitle(page: Pick<CmsPageDef, "absoluteTitle">, title: string): string {
  return page.absoluteTitle ? title : `${title} | Growwmatics AI`;
}
