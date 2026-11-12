import { MetadataRoute } from "next";
import { CMS_PAGES } from "@/lib/cms/pages";
import { cmsNoindexKeys } from "@/lib/cms/content";
import { listSitemapPosts, getUsedCategories } from "@/lib/blog/public";
import { SITE_URL, blogHomePath, blogPostPath, blogCategoryPath, type BlogLanguage } from "@/lib/blog/shared";

// Rebuilt whenever a post or page goes live (revalidatePath('/sitemap.xml'))
// and hourly as a safety net.
export const revalidate = 3600;

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

/**
 * Fixed "last changed" date for the hand-written pages. It used to be
 * `new Date()` on every request, which tells Google every page changed every
 * time it looks — so it learns to ignore the date. Bump this when the static
 * pages are meaningfully edited in code.
 */
const STATIC_PAGES_UPDATED = new Date("2026-11-12T00:00:00.000Z");

const PRIORITY: Record<string, { priority: number; changeFrequency: Freq }> = {
  home: { priority: 1, changeFrequency: "weekly" },
  pricing: { priority: 0.9, changeFrequency: "weekly" },
  "free-report": { priority: 0.9, changeFrequency: "weekly" },
  services: { priority: 0.9, changeFrequency: "weekly" },
  features: { priority: 0.85, changeFrequency: "weekly" },
  "gbp-booster": { priority: 0.85, changeFrequency: "weekly" },
  "book-demo": { priority: 0.8, changeFrequency: "monthly" },
  privacy: { priority: 0.4, changeFrequency: "yearly" },
  terms: { priority: 0.4, changeFrequency: "yearly" },
  refund: { priority: 0.4, changeFrequency: "yearly" },
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [hidden, posts, enCats, hiCats] = await Promise.all([
    cmsNoindexKeys(),
    listSitemapPosts(),
    getUsedCategories("en"),
    getUsedCategories("hi"),
  ]);

  const pages: MetadataRoute.Sitemap = CMS_PAGES.filter((p) => !hidden.has(p.key)).map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    lastModified: STATIC_PAGES_UPDATED,
    changeFrequency: PRIORITY[p.key]?.changeFrequency ?? (p.key.startsWith("service-") ? "weekly" : "monthly"),
    priority: PRIORITY[p.key]?.priority ?? (p.key.startsWith("service-") ? 0.85 : 0.7),
  }));

  const newest = (lang: BlogLanguage) =>
    posts.filter((p) => p.language === lang).reduce<Date | undefined>((d, p) => (!d || p.updatedAt > d ? p.updatedAt : d), undefined);

  const blogHomes: MetadataRoute.Sitemap = (["en", "hi"] as BlogLanguage[])
    .filter((lang) => posts.some((p) => p.language === lang))
    .map((lang) => ({
      url: `${SITE_URL}${blogHomePath(lang)}`,
      lastModified: newest(lang),
      changeFrequency: "daily" as Freq,
      priority: 0.8,
    }));

  // English ↔ Hindi pairs share a translationKey → hreflang alternates.
  const byKey = new Map<string, Partial<Record<BlogLanguage, string>>>();
  for (const p of posts) {
    const pair = byKey.get(p.translationKey) || {};
    pair[p.language] = `${SITE_URL}${blogPostPath(p.language, p.slug)}`;
    byKey.set(p.translationKey, pair);
  }
  const articles: MetadataRoute.Sitemap = posts.map((p) => {
    const pair = byKey.get(p.translationKey) || {};
    const both = pair.en && pair.hi;
    return {
      url: `${SITE_URL}${blogPostPath(p.language, p.slug)}`,
      lastModified: p.updatedAt,
      changeFrequency: "monthly" as Freq,
      priority: 0.7,
      ...(both ? { alternates: { languages: { en: pair.en!, hi: pair.hi! } } } : {}),
    };
  });

  const topics: MetadataRoute.Sitemap = [
    ...enCats.map((c) => ({ url: `${SITE_URL}${blogCategoryPath("en", c.slug)}`, changeFrequency: "weekly" as Freq, priority: 0.6 })),
    ...hiCats.map((c) => ({ url: `${SITE_URL}${blogCategoryPath("hi", c.slug)}`, changeFrequency: "weekly" as Freq, priority: 0.6 })),
  ];

  return [...pages, ...blogHomes, ...articles, ...topics];
}
