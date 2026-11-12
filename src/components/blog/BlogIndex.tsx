import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";
import { PostCard } from "@/components/blog/PostCard";
import {
  BLOG_TEXT,
  blogHomePath,
  blogCategoryPath,
  blogPagePath,
  CTA_DEFAULTS,
  type BlogLanguage,
} from "@/lib/blog/shared";
import type { PostCard as PostCardData, PublicCategory } from "@/lib/blog/public";

/**
 * Blog list — used by /blog, /blog/page/N, /blog/category/<slug> and the
 * Hindi equivalents. Server component; no client JS beyond the shared navbar.
 */
export function BlogIndex({
  lang,
  posts,
  page,
  pages,
  categories,
  activeCategory,
}: {
  lang: BlogLanguage;
  posts: PostCardData[];
  page: number;
  pages: number;
  categories: PublicCategory[];
  activeCategory?: PublicCategory | null;
}) {
  const t = BLOG_TEXT[lang];
  const home = blogHomePath(lang);
  const otherHome = blogHomePath(lang === "en" ? "hi" : "en");
  const pageHref = (n: number) =>
    activeCategory
      ? n <= 1
        ? blogCategoryPath(lang, activeCategory.slug)
        : `${blogCategoryPath(lang, activeCategory.slug)}?page=${n}`
      : blogPagePath(lang, n);
  const featured = !activeCategory && page === 1 ? posts[0] : undefined;
  const rest = featured ? posts.slice(1) : posts;
  const cta = CTA_DEFAULTS.free_report[lang];

  return (
    <main lang={lang} className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-4 sm:px-6">
        <nav aria-label="Breadcrumb" className="max-w-[1184px] mx-auto text-sm text-[#3d4a3d] flex flex-wrap items-center gap-2">
          <Link href="/" className="inline-block py-2.5 -my-2.5 hover:text-[#006e2c] transition-colors">{t.home}</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
          {activeCategory ? (
            <>
              <Link href={home} className="inline-block py-2.5 -my-2.5 hover:text-[#006e2c] transition-colors">{t.blog}</Link>
              <MaterialIcon name="chevron_right" size={16} className="text-[#9aa59c]" />
              <span className="text-[#101613] font-medium">{activeCategory.name}</span>
            </>
          ) : (
            <span className="text-[#101613] font-medium">{t.blog}</span>
          )}
          <Link
            href={otherHome}
            hrefLang={lang === "en" ? "hi" : "en"}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-(--mkt-line) bg-white px-3 py-1.5 text-xs font-semibold text-[#006e2c] hover:bg-[#f2f7f4]"
          >
            <MaterialIcon name="translate" size={14} />
            {t.otherLanguageBlog}
          </Link>
        </nav>
      </div>

      <header className="px-4 sm:px-6 pt-8 sm:pt-10 pb-6">
        <div className="max-w-[1184px] mx-auto">
          <p className="mkt-label text-[#006e2c] mb-3">{activeCategory ? t.categories : t.blog}</p>
          <h1 className="font-mkt-display text-3xl sm:text-4xl md:text-5xl font-semibold text-[#101613] tracking-tight leading-[1.12] max-w-3xl">
            {activeCategory ? activeCategory.name : t.heroTitle}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-[#3d4a3d] max-w-2xl leading-relaxed">
            {activeCategory?.description || t.heroText}
          </p>
        </div>
      </header>

      {categories.length > 0 && (
        <div className="px-4 sm:px-6 pb-6">
          <div className="max-w-[1184px] mx-auto -mx-4 sm:mx-auto overflow-x-auto">
            <ul className="flex gap-2 px-4 sm:px-0 pb-1 w-max sm:w-auto sm:flex-wrap">
              <li>
                <Link
                  href={home}
                  className={`inline-flex whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    !activeCategory ? "bg-[#101613] text-white" : "bg-white border border-(--mkt-line) text-[#26302a] hover:border-[#06b34c]"
                  }`}
                >
                  {t.allPosts}
                </Link>
              </li>
              {categories.map((c) => (
                <li key={c.id}>
                  <Link
                    href={blogCategoryPath(lang, c.slug)}
                    className={`inline-flex whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                      activeCategory?.id === c.id
                        ? "bg-[#101613] text-white"
                        : "bg-white border border-(--mkt-line) text-[#26302a] hover:border-[#06b34c]"
                    }`}
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="px-4 sm:px-6 pb-10">
        <div className="max-w-[1184px] mx-auto">
          {posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-(--mkt-line) bg-white p-10 text-center text-[#3d4a3d]">
              <MaterialIcon name="edit_note" size={40} className="mx-auto mb-3 text-[#9cc3ab]" />
              <p>{t.noPosts}</p>
            </div>
          ) : (
            <div className="grid gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {featured && <PostCard post={featured} lang={lang} featured />}
              {rest.map((p) => (
                <PostCard key={p.id} post={p} lang={lang} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-10 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  rel="prev"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-(--mkt-line) bg-white px-4 py-2.5 text-sm font-semibold text-[#101613] hover:border-[#06b34c]"
                >
                  <MaterialIcon name="arrow_back" size={16} />
                  {t.newer}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-[#6b756f]">{t.pageOf(page, pages)}</span>
              {page < pages ? (
                <Link
                  href={pageHref(page + 1)}
                  rel="next"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-(--mkt-line) bg-white px-4 py-2.5 text-sm font-semibold text-[#101613] hover:border-[#06b34c]"
                >
                  {t.older}
                  <MaterialIcon name="arrow_forward" size={16} />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </section>

      <InkCtaPanel heading={cta.heading} description={cta.text}>
        <Link
          href={cta.buttonUrl}
          className="w-full sm:w-auto px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md"
        >
          {cta.buttonLabel}
        </Link>
      </InkCtaPanel>

      <Footer />
    </main>
  );
}
