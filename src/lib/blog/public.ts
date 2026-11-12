import { cache } from "react";
import type { BlogLanguage } from "@/lib/blog/shared";
import { POSTS_PER_PAGE } from "@/lib/blog/shared";
import type { IBlogLive } from "@/models/BlogPost";
import { safeRead } from "@/lib/cms/safeRead";

/**
 * Public-site blog reads. Only ever returns the APPROVED `live` snapshot of a
 * post, and only once its publish time has passed — the working copy a team
 * member is editing is never read here.
 */

async function models() {
  const [{ default: dbConnect }, { default: BlogPost }, { default: BlogCategory }] = await Promise.all([
    import("@/lib/mongodb"),
    import("@/models/BlogPost"),
    import("@/models/BlogCategory"),
  ]);
  await dbConnect();
  return { BlogPost, BlogCategory };
}

// Loosely typed: Mongoose's strict filter types reject dotted paths + $ne on enums.
const liveFilter = (lang: BlogLanguage): Record<string, any> => ({
  language: lang,
  status: { $ne: "archived" },
  live: { $ne: null },
  "live.publishedAt": { $lte: new Date() },
});

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description?: string;
}

export interface PostCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImage?: { url: string; alt: string };
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  category?: PublicCategory | null;
}

export interface PublicPost extends PostCard {
  language: BlogLanguage;
  contentHtml: string;
  toc: IBlogLive["toc"];
  tags: string[];
  faqs: { question: string; answer: string }[];
  seo: IBlogLive["seo"];
  design: IBlogLive["design"];
  wordCount: number;
  translationKey: string;
  /** Live slug of the same article in the other language, if there is one. */
  translationSlug?: string | null;
}

function toCategory(c: any, lang: BlogLanguage): PublicCategory {
  return {
    id: String(c._id),
    slug: c.slug,
    name: (lang === "hi" && c.name?.hi) || c.name?.en || c.slug,
    description: (lang === "hi" && c.description?.hi) || c.description?.en || undefined,
  };
}

function toCard(p: any, cats: Map<string, PublicCategory>): PostCard {
  const l = p.live as IBlogLive;
  return {
    id: String(p._id),
    slug: l.slug,
    title: l.title,
    excerpt: l.excerpt,
    coverImage: l.coverImage?.url ? { url: l.coverImage.url, alt: l.coverImage.alt || l.title } : undefined,
    publishedAt: new Date(l.publishedAt).toISOString(),
    updatedAt: new Date(l.updatedAt || l.publishedAt).toISOString(),
    readingMinutes: l.readingMinutes || 1,
    category: l.categoryId ? cats.get(String(l.categoryId)) || null : null,
  };
}

const CARD_FIELDS =
  "live.slug live.title live.excerpt live.coverImage live.publishedAt live.updatedAt live.readingMinutes live.categoryId";

const allCategoriesMap = cache(async (lang: BlogLanguage) =>
  safeRead(
    "blog categories",
    async () => {
      const { BlogCategory } = await models();
      const rows = await BlogCategory.find().sort({ order: 1, "name.en": 1 }).lean();
      return new Map(rows.map((c: any) => [String(c._id), toCategory(c, lang)]));
    },
    new Map<string, PublicCategory>()
  )
);

/** Categories that have at least one live post in this language. */
export const getUsedCategories = cache(async (lang: BlogLanguage): Promise<PublicCategory[]> =>
  safeRead(
    "used categories",
    async () => {
      const { BlogPost } = await models();
      const ids: unknown[] = await BlogPost.distinct("live.categoryId", liveFilter(lang));
      const cats = await allCategoriesMap(lang);
      return ids
        .map((id) => (id ? cats.get(String(id)) : undefined))
        .filter((c): c is PublicCategory => Boolean(c))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    []
  )
);

export async function getCategoryBySlug(lang: BlogLanguage, slug: string): Promise<PublicCategory | null> {
  const cats = await allCategoriesMap(lang);
  for (const c of cats.values()) if (c.slug === slug) return c;
  return null;
}

export async function listLivePosts(
  lang: BlogLanguage,
  opts: { page?: number; categoryId?: string; limit?: number } = {}
): Promise<{ posts: PostCard[]; total: number; pages: number; page: number }> {
  const page = Math.max(1, Math.floor(opts.page || 1));
  const limit = opts.limit || POSTS_PER_PAGE;
  return safeRead(
    `blog list ${lang}`,
    async () => {
      const { BlogPost } = await models();
      const filter: Record<string, unknown> = liveFilter(lang);
      if (opts.categoryId) filter["live.categoryId"] = opts.categoryId;
      const [rows, total, cats] = await Promise.all([
        BlogPost.find(filter)
          .select(CARD_FIELDS)
          .sort({ "live.publishedAt": -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        BlogPost.countDocuments(filter),
        allCategoriesMap(lang),
      ]);
      return { posts: rows.map((r) => toCard(r, cats)), total, pages: Math.max(1, Math.ceil(total / limit)), page };
    },
    { posts: [], total: 0, pages: 1, page }
  );
}

export type PostLookup = { kind: "post"; post: PublicPost } | { kind: "redirect"; slug: string } | { kind: "none" };

export const getLivePost = cache(async (lang: BlogLanguage, slug: string): Promise<PostLookup> =>
  safeRead<PostLookup>(
    `blog post ${lang}/${slug}`,
    async () => {
      const { BlogPost } = await models();
      const doc: any = await BlogPost.findOne({ ...liveFilter(lang), "live.slug": slug })
        .select("live language translationKey")
        .lean();
      if (!doc) {
        // An old address of a post that was renamed → permanent redirect.
        const moved: any = await BlogPost.findOne({ ...liveFilter(lang), previousSlugs: slug }).select("live.slug").lean();
        return moved?.live?.slug ? { kind: "redirect", slug: moved.live.slug } : { kind: "none" };
      }
      const other: BlogLanguage = lang === "en" ? "hi" : "en";
      const [cats, twin] = await Promise.all([
        allCategoriesMap(lang),
        BlogPost.findOne({ ...liveFilter(other), translationKey: doc.translationKey }).select("live.slug").lean<any>(),
      ]);
      const l = doc.live as IBlogLive;
      return {
        kind: "post",
        post: {
          ...toCard(doc, cats),
          language: lang,
          contentHtml: l.contentHtml,
          toc: l.toc || [],
          tags: l.tags || [],
          faqs: (l.faqs || []).filter((f) => f.question && f.answer),
          seo: l.seo || {},
          design: l.design || { layout: "standard", showToc: true, cta: { type: "free_report" } },
          wordCount: l.wordCount || 0,
          translationKey: doc.translationKey,
          translationSlug: twin?.live?.slug || null,
        },
      };
    },
    { kind: "none" }
  )
);

/** Up to `n` other posts: same topic first, then the newest. */
export async function getRelatedPosts(post: PublicPost, n = 3): Promise<PostCard[]> {
  return safeRead(
    "related posts",
    async () => {
      const { BlogPost } = await models();
      const cats = await allCategoriesMap(post.language);
      const base = { ...liveFilter(post.language), _id: { $ne: post.id } };
      const same = post.category
        ? await BlogPost.find({ ...base, "live.categoryId": post.category.id })
            .select(CARD_FIELDS)
            .sort({ "live.publishedAt": -1 })
            .limit(n)
            .lean()
        : [];
      const need = n - same.length;
      const more = need
        ? await BlogPost.find({ ...base, _id: { $nin: [post.id, ...same.map((s: any) => s._id)] } })
            .select(CARD_FIELDS)
            .sort({ "live.publishedAt": -1 })
            .limit(need)
            .lean()
        : [];
      return [...same, ...more].map((r) => toCard(r, cats));
    },
    []
  );
}

/** Every live, indexable post for the sitemap. */
export async function listSitemapPosts(): Promise<
  { language: BlogLanguage; slug: string; updatedAt: Date; translationKey: string }[]
> {
  return safeRead(
    "sitemap posts",
    async () => {
      const { BlogPost } = await models();
      const rows: any[] = await BlogPost.find({
        status: { $ne: "archived" },
        live: { $ne: null },
        "live.publishedAt": { $lte: new Date() },
        "live.seo.noindex": { $ne: true },
      })
        .select("language translationKey live.slug live.updatedAt live.publishedAt")
        .lean();
      return rows.map((r) => ({
        language: r.language,
        slug: r.live.slug,
        updatedAt: new Date(r.live.updatedAt || r.live.publishedAt),
        translationKey: r.translationKey,
      }));
    },
    []
  );
}
