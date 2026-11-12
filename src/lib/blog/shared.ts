/**
 * Blog helpers shared by the public site, the Studio editor (client) and the
 * API (server). No DB / Node imports here.
 */
import type { BlogLanguage, BlogStatus, BlogCtaType, BlogLayout } from "@/models/BlogPost";

export type { BlogLanguage, BlogStatus, BlogCtaType, BlogLayout };

export const SITE_URL = "https://growwmatics.com";
export const BLOG_LANGUAGES: BlogLanguage[] = ["en", "hi"];
export const LANGUAGE_LABEL: Record<BlogLanguage, string> = { en: "English", hi: "हिन्दी (Hindi)" };

export const POSTS_PER_PAGE = 12;

// ---------- URLs ----------
export const blogHomePath = (lang: BlogLanguage) => (lang === "hi" ? "/hi/blog" : "/blog");
export const blogPostPath = (lang: BlogLanguage, slug: string) => `${blogHomePath(lang)}/${slug}`;
export const blogCategoryPath = (lang: BlogLanguage, slug: string) => `${blogHomePath(lang)}/category/${slug}`;
export const blogPagePath = (lang: BlogLanguage, page: number) =>
  page <= 1 ? blogHomePath(lang) : `${blogHomePath(lang)}/page/${page}`;

// ---------- Slugs ----------
/**
 * Web-address part of a post ("how-to-get-more-google-reviews"). Latin
 * letters, numbers and dashes only — Hindi titles need an English slug typed
 * by hand (Hindi characters turn into long %E0%A4… codes when shared).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidSlug = (slug: string) => SLUG_RE.test(slug) && slug.length >= 3 && slug.length <= 100;

/** Reserved words that would collide with blog routes. */
export const RESERVED_SLUGS = new Set(["page", "category", "rss", "rss-xml", "feed", "hi", "en"]);

// ---------- Status ----------
export const STATUS_LABEL: Record<BlogStatus, string> = {
  draft: "Draft",
  in_review: "Waiting for approval",
  changes_requested: "Changes requested",
  scheduled: "Scheduled",
  published: "Live",
  archived: "Taken down",
};

export const STATUS_TONE: Record<BlogStatus, "grey" | "amber" | "red" | "blue" | "green"> = {
  draft: "grey",
  in_review: "amber",
  changes_requested: "red",
  scheduled: "blue",
  published: "green",
  archived: "grey",
};

// ---------- Public-site wording ----------
export const BLOG_TEXT = {
  en: {
    blog: "Blog",
    home: "Home",
    heroTitle: "Grow your local business on Google",
    heroText:
      "Practical guides on Google Business Profile, reviews, local SEO and WhatsApp marketing — written for business owners in India.",
    readMore: "Read article",
    minRead: (n: number) => `${n} min read`,
    by: "By",
    published: "Published",
    updated: "Updated",
    contents: "On this page",
    faqTitle: "Frequently asked questions",
    related: "Keep reading",
    allPosts: "All articles",
    categories: "Topics",
    noPosts: "New articles are on the way. Check back soon.",
    newer: "Newer",
    older: "Older",
    pageOf: (p: number, t: number) => `Page ${p} of ${t}`,
    otherLanguage: "हिन्दी में पढ़ें",
    otherLanguageBlog: "हिन्दी ब्लॉग",
    share: "Share",
    tags: "Tags",
  },
  hi: {
    blog: "ब्लॉग",
    home: "होम",
    heroTitle: "Google पर अपना लोकल बिज़नेस बढ़ाएँ",
    heroText:
      "Google Business Profile, रिव्यू, लोकल SEO और WhatsApp मार्केटिंग पर आसान गाइड — भारत के बिज़नेस मालिकों के लिए।",
    readMore: "लेख पढ़ें",
    minRead: (n: number) => `${n} मिनट में पढ़ें`,
    by: "लेखक",
    published: "प्रकाशित",
    updated: "अपडेट",
    contents: "इस लेख में",
    faqTitle: "अक्सर पूछे जाने वाले सवाल",
    related: "और पढ़ें",
    allPosts: "सभी लेख",
    categories: "विषय",
    noPosts: "नए लेख जल्द आ रहे हैं।",
    newer: "नए",
    older: "पुराने",
    pageOf: (p: number, t: number) => `पेज ${p} / ${t}`,
    otherLanguage: "Read in English",
    otherLanguageBlog: "English blog",
    share: "शेयर करें",
    tags: "टैग",
  },
} as const;

export const AUTHOR_NAME = "Growwmatics AI";

// ---------- Default CTA wording (when the post uses a built-in CTA) ----------
export const CTA_DEFAULTS: Record<Exclude<BlogCtaType, "custom" | "none">, Record<BlogLanguage, { heading: string; text: string; buttonLabel: string; buttonUrl: string }>> = {
  free_report: {
    en: {
      heading: "See how your Google Business Profile scores",
      text: "Get a free report with your profile score, review health and how you compare to nearby competitors.",
      buttonLabel: "Get my free report",
      buttonUrl: "/free-report",
    },
    hi: {
      heading: "देखें आपका Google Business Profile कितना मज़बूत है",
      text: "मुफ़्त रिपोर्ट पाएँ — प्रोफ़ाइल स्कोर, रिव्यू की स्थिति और आस-पास के प्रतियोगियों से तुलना।",
      buttonLabel: "मुफ़्त रिपोर्ट पाएँ",
      buttonUrl: "/free-report",
    },
  },
  book_demo: {
    en: {
      heading: "Let Growwmatics AI run your Google profile",
      text: "Book a free 15-minute demo and see the AI post, reply to reviews and follow up with leads on WhatsApp.",
      buttonLabel: "Book a free demo",
      buttonUrl: "/book-demo",
    },
    hi: {
      heading: "Growwmatics AI को अपना Google प्रोफ़ाइल संभालने दें",
      text: "15 मिनट का मुफ़्त डेमो बुक करें और देखें AI कैसे पोस्ट, रिव्यू रिप्लाई और WhatsApp फ़ॉलो-अप करता है।",
      buttonLabel: "मुफ़्त डेमो बुक करें",
      buttonUrl: "/book-demo",
    },
  },
};

// ---------- Content measures ----------
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(html: string): number {
  const text = stripHtml(html);
  return text ? text.split(" ").length : 0;
}

/** ~200 wpm for English, ~150 for Hindi. */
export function readingMinutes(words: number, lang: BlogLanguage): number {
  return Math.max(1, Math.round(words / (lang === "hi" ? 150 : 200)));
}

// ---------- Limits shown in the editor ----------
export const LIMITS = {
  seoTitle: { ideal: [30, 60] as const, max: 70 },
  seoDescription: { ideal: [110, 160] as const, max: 170 },
  excerpt: { ideal: [80, 220] as const, max: 300 },
  minWordsToSubmit: 150,
};

// ---------- SEO checklist (editor sidebar + submit check) ----------
export interface SeoCheck {
  id: string;
  label: string;
  /** Plain-language fix for a non-technical editor. */
  hint: string;
  status: "good" | "warn" | "bad";
  /** Blocking checks must pass before the post can be submitted. */
  blocking?: boolean;
}

export interface CheckablePost {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  coverImage?: { url?: string; alt?: string } | null;
  seo?: { title?: string; description?: string; focusKeyword?: string } | null;
  language: BlogLanguage;
}

const between = (n: number, [a, b]: readonly [number, number]) => n >= a && n <= b;

export function runSeoChecks(p: CheckablePost): SeoCheck[] {
  const checks: SeoCheck[] = [];
  const text = stripHtml(p.contentHtml || "");
  const words = text ? text.split(" ").length : 0;
  const seoTitle = (p.seo?.title || p.title || "").trim();
  const seoDesc = (p.seo?.description || p.excerpt || "").trim();
  const kw = (p.seo?.focusKeyword || "").trim().toLowerCase();

  checks.push({
    id: "title",
    label: "Post has a title",
    hint: "Write a clear title that says what the reader will learn.",
    status: p.title.trim().length >= 10 ? "good" : "bad",
    blocking: true,
  });
  checks.push({
    id: "slug",
    label: "Web address is set",
    hint: "Use short English words with dashes, e.g. get-more-google-reviews.",
    status: isValidSlug(p.slug) && !RESERVED_SLUGS.has(p.slug) ? "good" : "bad",
    blocking: true,
  });
  checks.push({
    id: "length",
    label: `Article length (${words} words)`,
    hint: `Write at least ${LIMITS.minWordsToSubmit} words. 800+ words usually ranks better on Google.`,
    status: words >= 800 ? "good" : words >= LIMITS.minWordsToSubmit ? "warn" : "bad",
    blocking: true,
  });
  checks.push({
    id: "excerpt",
    label: "Short summary is written",
    hint: "One or two sentences shown on the blog list and in Google.",
    status: between(p.excerpt.trim().length, LIMITS.excerpt.ideal) ? "good" : p.excerpt.trim().length > 20 ? "warn" : "bad",
    blocking: true,
  });
  checks.push({
    id: "cover",
    label: "Cover image with a description",
    hint: "Add a cover image and describe it in a few words (helps Google and blind readers).",
    status: p.coverImage?.url ? (p.coverImage.alt?.trim() ? "good" : "warn") : "warn",
  });
  checks.push({
    id: "seoTitle",
    label: `Google title length (${seoTitle.length} characters)`,
    hint: "Keep the Google title between 30 and 60 characters so it is not cut off.",
    status: between(seoTitle.length, LIMITS.seoTitle.ideal) ? "good" : seoTitle.length > LIMITS.seoTitle.max ? "bad" : "warn",
  });
  checks.push({
    id: "seoDesc",
    label: `Google description length (${seoDesc.length} characters)`,
    hint: "Aim for 110–160 characters: what the reader gets from this article.",
    status: between(seoDesc.length, LIMITS.seoDescription.ideal) ? "good" : seoDesc.length > LIMITS.seoDescription.max ? "bad" : "warn",
  });

  const h2 = (p.contentHtml.match(/<h2[\s>]/gi) || []).length;
  checks.push({
    id: "headings",
    label: `Section headings (${h2})`,
    hint: "Break the article into sections with “Heading” (H2). 3 or more is ideal.",
    status: h2 >= 3 ? "good" : h2 >= 1 ? "warn" : "bad",
  });

  const imgs = p.contentHtml.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = imgs.filter((t) => !/\balt="[^"]+"/i.test(t)).length;
  if (imgs.length) {
    checks.push({
      id: "alt",
      label: missingAlt ? `${missingAlt} image(s) without a description` : "All images have descriptions",
      hint: "Click an image in the editor and add a description.",
      status: missingAlt ? "warn" : "good",
    });
  }

  const internal = (p.contentHtml.match(/href="(\/(?!\/)|https:\/\/growwmatics\.com)/gi) || []).length;
  checks.push({
    id: "links",
    label: `Links to our own pages (${internal})`,
    hint: "Link to at least 2 of our pages, e.g. the Free report or another article.",
    status: internal >= 2 ? "good" : internal === 1 ? "warn" : "bad",
  });

  if (kw) {
    const inTitle = seoTitle.toLowerCase().includes(kw) || p.title.toLowerCase().includes(kw);
    const firstPara = text.slice(0, 600).toLowerCase().includes(kw);
    const kwSlug = slugify(kw);
    const inSlug = kwSlug ? p.slug.includes(kwSlug) : true;
    checks.push({
      id: "kwTitle",
      label: "Main keyword is in the title",
      hint: `Use “${p.seo?.focusKeyword}” in the title.`,
      status: inTitle ? "good" : "warn",
    });
    checks.push({
      id: "kwIntro",
      label: "Main keyword is in the first paragraph",
      hint: `Mention “${p.seo?.focusKeyword}” early in the article.`,
      status: firstPara ? "good" : "warn",
    });
    if (p.language === "en") {
      checks.push({
        id: "kwSlug",
        label: "Main keyword is in the web address",
        hint: "Put the keyword words in the web address too.",
        status: inSlug ? "good" : "warn",
      });
    }
  } else {
    checks.push({
      id: "kw",
      label: "Main keyword chosen",
      hint: "Type the search phrase you want this article to rank for, e.g. “google reviews for clinics”.",
      status: "warn",
    });
  }

  return checks;
}

/** Score 0–100 for the editor gauge. */
export function seoScore(checks: SeoCheck[]): number {
  if (!checks.length) return 0;
  const pts = checks.reduce((s, c) => s + (c.status === "good" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  return Math.round((pts / checks.length) * 100);
}
