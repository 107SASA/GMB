import { cache } from "react";
import type { Metadata } from "next";
import { sharedOpenGraph } from "@/lib/seo";
import { getCmsPage, type CmsPageDef } from "@/lib/cms/pages";
import type { FaqEntry } from "@/lib/faqData";
import type { ISitePageFields } from "@/models/SitePageContent";
import { safeRead } from "@/lib/cms/safeRead";

/**
 * Server-side reads of APPROVED website-page content (SitePageContent.live)
 * for public pages. Wrapped in React cache() so generateMetadata and the page
 * body share one DB read per render.
 */
const loadLive = cache(async (key: string): Promise<ISitePageFields | null> =>
  safeRead(
    `page ${key}`,
    async () => {
      const [{ default: dbConnect }, { default: SitePageContent }] = await Promise.all([
        import("@/lib/mongodb"),
        import("@/models/SitePageContent"),
      ]);
      await dbConnect();
      const doc = await SitePageContent.findOne({ pageKey: key }).select("live").lean<{ live?: ISitePageFields | null }>();
      return doc?.live ?? null;
    },
    null
  )
);

const pick = (v: string | undefined | null, fallback: string) => (v && v.trim() ? v.trim() : fallback);

function build(page: CmsPageDef, live: ISitePageFields | null): Metadata {
  const title = pick(live?.seoTitle, page.title);
  const description = pick(live?.seoDescription, page.description);
  const ogTitle = pick(live?.ogTitle, page.ogTitle || (page.absoluteTitle ? title : `${title} | Growwmatics AI`));
  const ogDescription = pick(live?.ogDescription, page.ogDescription || description);
  const images = live?.ogImageUrl
    ? [{ url: live.ogImageUrl, width: 1200, height: 630, alt: ogTitle }]
    : sharedOpenGraph.images;

  return {
    title: page.absoluteTitle ? { absolute: title } : title,
    description,
    ...(page.keywords?.length ? { keywords: page.keywords } : {}),
    alternates: { canonical: page.path },
    openGraph: {
      ...sharedOpenGraph,
      images,
      title: ogTitle,
      description: ogDescription,
      url: page.path,
      type: "website",
    },
    ...(live?.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Full page metadata: built-in defaults, overridden by whatever a Super Admin approved. */
export async function cmsMetadata(key: string): Promise<Metadata> {
  const page = getCmsPage(key);
  if (!page) throw new Error(`cmsMetadata: unknown page key "${key}"`);
  return build(page, await loadLive(key));
}

/** The page's FAQ list — the approved one if set, otherwise the built-in list. */
export async function cmsFaqs(key: string): Promise<FaqEntry[]> {
  const page = getCmsPage(key);
  const fallback = page?.faqs ?? [];
  const live = await loadLive(key);
  const faqs = (live?.faqs || []).filter((f) => f.question?.trim() && f.answer?.trim());
  return faqs.length ? faqs : fallback;
}

/** Whether the approved content hides this page from Google (used by the sitemap). */
export async function cmsNoindexKeys(): Promise<Set<string>> {
  return safeRead(
    "noindex list",
    async () => {
      const [{ default: dbConnect }, { default: SitePageContent }] = await Promise.all([
        import("@/lib/mongodb"),
        import("@/models/SitePageContent"),
      ]);
      await dbConnect();
      const rows = await SitePageContent.find({ "live.noindex": true }).select("pageKey").lean<{ pageKey: string }[]>();
      return new Set(rows.map((r) => r.pageKey));
    },
    new Set<string>()
  );
}
