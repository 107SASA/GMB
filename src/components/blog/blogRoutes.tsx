import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { BlogIndex } from "@/components/blog/BlogIndex";
import { ArticleView } from "@/components/blog/ArticleView";
import { breadcrumbSchema, faqPageSchema } from "@/lib/seoSchemas";
import { sharedOpenGraph } from "@/lib/seo";
import {
  AUTHOR_NAME,
  BLOG_TEXT,
  SITE_URL,
  blogHomePath,
  blogPostPath,
  blogCategoryPath,
  blogPagePath,
  type BlogLanguage,
} from "@/lib/blog/shared";
import {
  listLivePosts,
  getLivePost,
  getRelatedPosts,
  getUsedCategories,
  getCategoryBySlug,
} from "@/lib/blog/public";

/**
 * Shared implementations of the public blog routes. /blog/* and /hi/blog/*
 * route files are one-liners that call these with their language.
 */

const OG_LOCALE: Record<BlogLanguage, string> = { en: "en_IN", hi: "hi_IN" };

function langAlternates(path: (l: BlogLanguage) => string) {
  return { en: path("en"), hi: path("hi"), "x-default": path("en") };
}

// ---------- list pages ----------

export async function blogIndexMetadata(lang: BlogLanguage, page = 1): Promise<Metadata> {
  const t = BLOG_TEXT[lang];
  const title = lang === "hi" ? "ब्लॉग — Google पर लोकल बिज़नेस बढ़ाने की गाइड" : "Blog — Local SEO & Google Business Profile Guides";
  const pageTitle = page > 1 ? `${title} — ${lang === "hi" ? "पेज" : "Page"} ${page}` : title;
  return {
    title: pageTitle,
    description: t.heroText,
    alternates: {
      canonical: blogPagePath(lang, page),
      ...(page === 1 ? { languages: langAlternates(blogHomePath) } : {}),
      types: { "application/rss+xml": `${blogHomePath(lang)}/rss.xml` },
    },
    openGraph: {
      ...sharedOpenGraph,
      locale: OG_LOCALE[lang],
      title: `${title} | Growwmatics AI`,
      description: t.heroText,
      url: blogPagePath(lang, page),
      type: "website",
    },
  };
}

export async function BlogIndexRoute({ lang, page = 1 }: { lang: BlogLanguage; page?: number }) {
  if (!Number.isInteger(page) || page < 1) notFound();
  const [list, categories] = await Promise.all([listLivePosts(lang, { page }), getUsedCategories(lang)]);
  if (page > 1 && page > list.pages) notFound();
  const t = BLOG_TEXT[lang];
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: `Growwmatics AI ${t.blog}`,
          url: `${SITE_URL}${blogHomePath(lang)}`,
          inLanguage: lang === "hi" ? "hi-IN" : "en-IN",
          publisher: { "@type": "Organization", name: AUTHOR_NAME, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png` } },
          blogPost: list.posts.slice(0, 10).map((p) => ({
            "@type": "BlogPosting",
            headline: p.title,
            url: `${SITE_URL}${blogPostPath(lang, p.slug)}`,
            datePublished: p.publishedAt,
          })),
        }}
      />
      <JsonLd data={breadcrumbSchema([{ name: t.home, path: "/" }, { name: t.blog, path: blogHomePath(lang) }])} />
      <BlogIndex lang={lang} posts={list.posts} page={list.page} pages={list.pages} categories={categories} />
    </>
  );
}

// ---------- topic pages ----------

export async function blogCategoryMetadata(lang: BlogLanguage, slug: string): Promise<Metadata> {
  const cat = await getCategoryBySlug(lang, slug);
  if (!cat) return { title: BLOG_TEXT[lang].blog, robots: { index: false } };
  const description = cat.description || BLOG_TEXT[lang].heroText;
  return {
    title: `${cat.name} — ${BLOG_TEXT[lang].blog}`,
    description,
    alternates: { canonical: blogCategoryPath(lang, slug), languages: langAlternates((l) => blogCategoryPath(l, slug)) },
    openGraph: {
      ...sharedOpenGraph,
      locale: OG_LOCALE[lang],
      title: `${cat.name} | Growwmatics AI`,
      description,
      url: blogCategoryPath(lang, slug),
      type: "website",
    },
  };
}

export async function BlogCategoryRoute({ lang, slug }: { lang: BlogLanguage; slug: string }) {
  const cat = await getCategoryBySlug(lang, slug);
  if (!cat) notFound();
  const [list, categories] = await Promise.all([
    listLivePosts(lang, { categoryId: cat.id, limit: 60 }),
    getUsedCategories(lang),
  ]);
  if (list.total === 0) notFound();
  const t = BLOG_TEXT[lang];
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: t.home, path: "/" },
          { name: t.blog, path: blogHomePath(lang) },
          { name: cat.name, path: blogCategoryPath(lang, slug) },
        ])}
      />
      <BlogIndex lang={lang} posts={list.posts} page={1} pages={1} categories={categories} activeCategory={cat} />
    </>
  );
}

// ---------- article pages ----------

export async function blogPostMetadata(lang: BlogLanguage, slug: string): Promise<Metadata> {
  const found = await getLivePost(lang, slug);
  if (found.kind !== "post") return { title: BLOG_TEXT[lang].blog, robots: { index: false } };
  const p = found.post;
  const title = p.seo?.title || p.title;
  const description = p.seo?.description || p.excerpt;
  const image = p.seo?.ogImageUrl || p.coverImage?.url;
  const languages: Record<string, string> = { [lang]: blogPostPath(lang, p.slug) };
  if (p.translationSlug) languages[lang === "en" ? "hi" : "en"] = blogPostPath(lang === "en" ? "hi" : "en", p.translationSlug);
  languages["x-default"] = languages.en || blogPostPath(lang, p.slug);
  return {
    title,
    description,
    keywords: p.seo?.focusKeyword ? [p.seo.focusKeyword, ...p.tags] : p.tags,
    authors: [{ name: AUTHOR_NAME, url: SITE_URL }],
    alternates: { canonical: blogPostPath(lang, p.slug), languages },
    openGraph: {
      ...sharedOpenGraph,
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: p.coverImage?.alt || title }] } : {}),
      locale: OG_LOCALE[lang],
      title,
      description,
      url: blogPostPath(lang, p.slug),
      type: "article",
      publishedTime: p.publishedAt,
      modifiedTime: p.updatedAt,
      authors: [AUTHOR_NAME],
      ...(p.category ? { section: p.category.name } : {}),
      tags: p.tags,
    },
    ...(p.seo?.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export async function BlogPostRoute({ lang, slug }: { lang: BlogLanguage; slug: string }) {
  const found = await getLivePost(lang, slug);
  if (found.kind === "redirect") permanentRedirect(blogPostPath(lang, found.slug));
  if (found.kind !== "post") notFound();
  const p = found.post;
  const related = await getRelatedPosts(p, 3);
  const t = BLOG_TEXT[lang];
  const url = `${SITE_URL}${blogPostPath(lang, p.slug)}`;
  const image = p.seo?.ogImageUrl || p.coverImage?.url || `${SITE_URL}/opengraph-image`;
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: p.title,
          description: p.seo?.description || p.excerpt,
          image: [image],
          datePublished: p.publishedAt,
          dateModified: p.updatedAt,
          inLanguage: lang === "hi" ? "hi-IN" : "en-IN",
          wordCount: p.wordCount,
          ...(p.category ? { articleSection: p.category.name } : {}),
          ...(p.tags.length ? { keywords: p.tags.join(", ") } : {}),
          mainEntityOfPage: { "@type": "WebPage", "@id": url },
          url,
          author: { "@type": "Organization", name: AUTHOR_NAME, url: SITE_URL },
          publisher: { "@type": "Organization", name: AUTHOR_NAME, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png` } },
        }}
      />
      <JsonLd
        data={breadcrumbSchema([
          { name: t.home, path: "/" },
          { name: t.blog, path: blogHomePath(lang) },
          ...(p.category ? [{ name: p.category.name, path: blogCategoryPath(lang, p.category.slug) }] : []),
          { name: p.title, path: blogPostPath(lang, p.slug) },
        ])}
      />
      {p.faqs.length > 0 && <JsonLd data={faqPageSchema(p.faqs)} />}
      <ArticleView post={p} related={related} />
    </>
  );
}

// ---------- RSS ----------

const x = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export async function blogRss(lang: BlogLanguage): Promise<Response> {
  const { posts } = await listLivePosts(lang, { limit: 30 });
  const t = BLOG_TEXT[lang];
  const items = posts
    .map(
      (p) => `<item>
  <title>${x(p.title)}</title>
  <link>${SITE_URL}${blogPostPath(lang, p.slug)}</link>
  <guid isPermaLink="true">${SITE_URL}${blogPostPath(lang, p.slug)}</guid>
  <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
  <description>${x(p.excerpt)}</description>
</item>`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${x(`Growwmatics AI — ${t.blog}`)}</title>
  <link>${SITE_URL}${blogHomePath(lang)}</link>
  <atom:link href="${SITE_URL}${blogHomePath(lang)}/rss.xml" rel="self" type="application/rss+xml" />
  <description>${x(t.heroText)}</description>
  <language>${lang === "hi" ? "hi-in" : "en-in"}</language>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
