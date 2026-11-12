import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { FaqAccordion } from "@/components/shared/FaqAccordion";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";
import { PostCard, formatBlogDate } from "@/components/blog/PostCard";
import {
  AUTHOR_NAME,
  BLOG_TEXT,
  CTA_DEFAULTS,
  SITE_URL,
  blogHomePath,
  blogPostPath,
  blogCategoryPath,
  type BlogLanguage,
} from "@/lib/blog/shared";
import type {
  PostCard as PostCardData,
  PublicCategory,
} from "@/lib/blog/public";
import type { IBlogDesign, IBlogTocItem } from "@/models/BlogPost";

export interface ArticleData {
  language: BlogLanguage;
  slug: string;
  title: string;
  excerpt: string;
  contentHtml: string;
  coverImage?: { url: string; alt: string; width?: number; height?: number };
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  category?: PublicCategory | null;
  tags: string[];
  toc: IBlogTocItem[];
  faqs: { question: string; answer: string }[];
  design: IBlogDesign;
  translationSlug?: string | null;
}

function Toc({
  items,
  title,
  compact,
}: {
  items: IBlogTocItem[];
  title: string;
  compact?: boolean;
}) {
  if (items.length < 2) return null;
  const list = (
    <ol className="space-y-1.5 text-sm">
      {items.map((i) => (
        <li key={i.id} className={i.level === 3 ? "pl-4" : ""}>
          <a
            href={`#${i.id}`}
            className="block rounded-md px-2 py-1.5 text-[#3d4a3d] hover:bg-[#e3f5ea] hover:text-[#006e2c] leading-snug"
          >
            {i.text}
          </a>
        </li>
      ))}
    </ol>
  );
  if (compact) {
    return (
      <details className="group rounded-xl border border-(--mkt-line) bg-white p-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-[#101613]">
          <span className="inline-flex items-center gap-2">
            <MaterialIcon name="toc" size={18} className="text-[#006e2c]" />
            {title}
          </span>
          <MaterialIcon
            name="expand_more"
            size={20}
            className="transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-3">{list}</div>
      </details>
    );
  }
  return (
    <nav
      aria-label={title}
      className="rounded-xl border border-(--mkt-line) bg-white p-4"
    >
      <p className="mkt-label mb-3 text-[#6b756f]">{title}</p>
      {list}
    </nav>
  );
}

function Share({
  url,
  title,
  label,
}: {
  url: string;
  title: string;
  label: string;
}) {
  const u = encodeURIComponent(url);
  const tx = encodeURIComponent(title);
  const links = [
    {
      name: "WhatsApp",
      icon: "chat",
      href: `https://wa.me/?text=${tx}%20${u}`,
    },
    {
      name: "LinkedIn",
      icon: "work",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    },
    {
      name: "X",
      icon: "tag",
      href: `https://twitter.com/intent/tweet?text=${tx}&url=${u}`,
    },
    {
      name: "Facebook",
      icon: "thumb_up",
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-[#101613] mr-1">{label}</span>
      {links.map((l) => (
        <a
          key={l.name}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label}: ${l.name}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-(--mkt-line) bg-white px-3 py-1.5 text-xs font-semibold text-[#26302a] hover:border-[#06b34c] hover:text-[#006e2c]"
        >
          <MaterialIcon name={l.icon} size={14} />
          {l.name}
        </a>
      ))}
    </div>
  );
}

export function ArticleView({
  post,
  related = [],
  preview = false,
}: {
  post: ArticleData;
  related?: PostCardData[];
  /** Studio preview: banner on top, links stay inert-ish, nothing indexed. */
  preview?: boolean;
}) {
  const lang = post.language;
  const t = BLOG_TEXT[lang];
  const layout = post.design?.layout || "standard";
  const showToc = post.design?.showToc !== false && post.toc.length >= 2;
  const url = `${SITE_URL}${blogPostPath(lang, post.slug || "preview")}`;
  const otherLang: BlogLanguage = lang === "en" ? "hi" : "en";
  const ctaType = post.design?.cta?.type || "free_report";
  const cta =
    ctaType === "none"
      ? null
      : ctaType === "custom"
        ? post.design.cta.heading &&
          post.design.cta.buttonLabel &&
          post.design.cta.buttonUrl
          ? {
              heading: post.design.cta.heading,
              text: post.design.cta.text || "",
              buttonLabel: post.design.cta.buttonLabel,
              buttonUrl: post.design.cta.buttonUrl,
            }
          : null
        : CTA_DEFAULTS[ctaType][lang];
  // Header and body share one container so their left edges line up.
  const withSidebar = showToc && layout !== "minimal";
  const container = withSidebar ? "max-w-6xl" : "max-w-3xl";
  const updated =
    post.updatedAt &&
    post.updatedAt.slice(0, 10) !== post.publishedAt.slice(0, 10);

  const meta = (dark = false) => (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${dark ? "text-white/80" : "text-[#6b756f]"}`}
    >
      <span className="inline-flex items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/icon.png"
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 rounded-full bg-white object-contain"
        />
        <span
          className={
            dark ? "text-white font-semibold" : "text-[#101613] font-semibold"
          }
        >
          {AUTHOR_NAME}
        </span>
      </span>
      <span aria-hidden>·</span>
      <time dateTime={post.publishedAt}>
        {formatBlogDate(post.publishedAt, lang)}
      </time>
      {updated && (
        <>
          <span aria-hidden>·</span>
          <span>
            {t.updated}{" "}
            <time dateTime={post.updatedAt}>
              {formatBlogDate(post.updatedAt, lang)}
            </time>
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>{t.minRead(post.readingMinutes)}</span>
    </div>
  );

  const crumbs = (dark = false) => (
    <nav
      aria-label="Breadcrumb"
      className={`text-sm flex flex-wrap items-center gap-2 ${dark ? "text-white/80" : "text-[#3d4a3d]"}`}
    >
      <Link href="/" className="inline-block py-2.5 -my-2.5 hover:underline">
        {t.home}
      </Link>
      <MaterialIcon
        name="chevron_right"
        size={16}
        className={dark ? "text-white/50" : "text-[#9aa59c]"}
      />
      <Link
        href={blogHomePath(lang)}
        className="inline-block py-2.5 -my-2.5 hover:underline"
      >
        {t.blog}
      </Link>
      {post.category && (
        <>
          <MaterialIcon
            name="chevron_right"
            size={16}
            className={dark ? "text-white/50" : "text-[#9aa59c]"}
          />
          <Link
            href={blogCategoryPath(lang, post.category.slug)}
            className="inline-block py-2.5 -my-2.5 hover:underline"
          >
            {post.category.name}
          </Link>
        </>
      )}
    </nav>
  );

  const langSwitch = post.translationSlug ? (
    <Link
      href={blogPostPath(otherLang, post.translationSlug)}
      hrefLang={otherLang}
      className="inline-flex items-center gap-1.5 rounded-full border border-(--mkt-line) bg-white px-3 py-1.5 text-xs font-semibold text-[#006e2c] hover:bg-[#f2f7f4]"
    >
      <MaterialIcon name="translate" size={14} />
      {t.otherLanguage}
    </Link>
  ) : null;

  const cover = post.coverImage?.url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={post.coverImage.url}
      alt={post.coverImage.alt || post.title}
      width={post.coverImage.width || 1600}
      height={post.coverImage.height || 900}
      fetchPriority="high"
      decoding="async"
      className="h-full w-full object-cover"
    />
  ) : null;

  return (
    <main
      lang={lang}
      className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed"
    >
      {preview && (
        <div className="fixed inset-x-0 top-0 z-[60] bg-[#f59e0b] px-4 py-2 text-center text-sm font-semibold text-[#1f1300]">
          Preview — this is how the post will look. It is not on the website
          until a Super Admin approves it.
        </div>
      )}
      <Navbar />

      {layout === "wide" && cover ? (
        <header className="relative mt-16 md:mt-20 min-h-[420px] sm:min-h-[480px] overflow-hidden">
          <div className="absolute inset-0">{cover}</div>
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a120e]/95 via-[#0a120e]/60 to-[#0a120e]/20" />
          <div
            className={`relative mx-auto flex min-h-[420px] sm:min-h-[480px] ${container} flex-col justify-end px-4 sm:px-6 pb-10 pt-16`}
          >
            {crumbs(true)}
            <h1 className="mt-5 font-mkt-display text-3xl sm:text-4xl md:text-5xl font-semibold leading-[1.12] tracking-tight text-white">
              {post.title}
            </h1>
            {post.excerpt && (
              <p className="mt-4 max-w-2xl text-base sm:text-lg text-white/85 leading-relaxed">
                {post.excerpt}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {meta(true)}
              {langSwitch}
            </div>
          </div>
        </header>
      ) : (
        <header className="px-4 sm:px-6 pt-24 md:pt-28">
          <div className={`mx-auto ${container}`}>
            <div className={withSidebar ? "max-w-4xl" : ""}>
              <div className="flex flex-wrap items-center gap-3">
                {crumbs()}
                <span className="ml-auto">{langSwitch}</span>
              </div>
              <h1 className="mt-6 font-mkt-display text-3xl sm:text-4xl md:text-5xl font-semibold leading-[1.12] tracking-tight text-[#101613]">
                {post.title}
              </h1>
              {post.excerpt && (
                <p className="mt-4 text-base sm:text-lg text-[#3d4a3d] leading-relaxed">
                  {post.excerpt}
                </p>
              )}
              <div className="mt-5">{meta()}</div>
              {layout === "standard" && cover && (
                <div className="mt-8 aspect-[16/9] overflow-hidden rounded-2xl border border-(--mkt-line) bg-white">
                  {cover}
                </div>
              )}
            </div>
          </div>
        </header>
      )}

      <div className="px-4 sm:px-6 pt-8 sm:pt-10 pb-12">
        <div
          className={`mx-auto ${container} ${withSidebar ? "lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-12" : ""}`}
        >
          <div className="min-w-0">
            {showToc && (
              <div className="mb-8">
                <Toc
                  items={post.toc}
                  title={t.contents}
                  compact={withSidebar}
                />
              </div>
            )}
            <article
              className="blog-prose"
              dangerouslySetInnerHTML={{ __html: post.contentHtml }}
            />

            {post.faqs.length > 0 && (
              <section className="mt-12">
                <h2 className="font-mkt-display text-2xl sm:text-3xl font-semibold text-[#101613] tracking-tight mb-6">
                  {t.faqTitle}
                </h2>
                <div className="rounded-xl border border-(--mkt-line) bg-white p-4 sm:p-6">
                  <FaqAccordion faqs={post.faqs} defaultOpenIndex={0} />
                </div>
              </section>
            )}

            {post.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[#101613] mr-1">
                  {t.tags}
                </span>
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-white border border-(--mkt-line) px-3 py-1 text-xs text-[#3d4a3d]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-8 border-t border-(--mkt-line) pt-6">
              <Share url={url} title={post.title} label={t.share} />
            </div>

            <div className="mt-8 flex items-center gap-4 rounded-2xl border border-(--mkt-line) bg-white p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/icon.png"
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 object-contain"
              />
              <div>
                <p className="font-semibold text-[#101613]">{AUTHOR_NAME}</p>
                <p className="text-sm text-[#3d4a3d] leading-relaxed">
                  {lang === "hi"
                    ? "आपकी अपनी AI मार्केटिंग टीम — Google Business Profile, रिव्यू और WhatsApp फ़ॉलो-अप, भारत के लोकल बिज़नेस के लिए।"
                    : "Your own AI marketing team — Google Business Profile, reviews and WhatsApp follow-up for local businesses in India."}
                </p>
              </div>
            </div>
          </div>

          {withSidebar && (
            <aside className="hidden lg:block">
              <div className="sticky top-28">
                <Toc items={post.toc} title={t.contents} />
              </div>
            </aside>
          )}
        </div>
      </div>

      {cta && (
        <InkCtaPanel heading={cta.heading} description={cta.text}>
          <Link
            href={cta.buttonUrl}
            className="w-full sm:w-auto px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md"
          >
            {cta.buttonLabel}
          </Link>
        </InkCtaPanel>
      )}

      {related.length > 0 && (
        <section className="px-4 sm:px-6 pb-16">
          <div className="max-w-[1184px] mx-auto">
            <h2 className="font-mkt-display text-2xl sm:text-3xl font-semibold text-[#101613] tracking-tight mb-6">
              {t.related}
            </h2>
            <div className="grid gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {related.map((p) => (
                <PostCard key={p.id} post={p} lang={lang} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </main>
  );
}
