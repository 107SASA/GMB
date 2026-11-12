import Link from "next/link";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BLOG_TEXT, blogPostPath, blogCategoryPath, type BlogLanguage } from "@/lib/blog/shared";
import type { PostCard as PostCardData } from "@/lib/blog/public";

export function formatBlogDate(iso: string, lang: BlogLanguage) {
  return new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PostCard({ post, lang, featured = false }: { post: PostCardData; lang: BlogLanguage; featured?: boolean }) {
  const t = BLOG_TEXT[lang];
  const href = blogPostPath(lang, post.slug);
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-(--mkt-line) bg-white shadow-sm transition-shadow hover:shadow-md ${
        featured ? "md:col-span-2 lg:col-span-3 lg:flex-row" : ""
      }`}
    >
      <div className={`relative overflow-hidden bg-[#dfeae4] ${featured ? "aspect-[16/9] lg:aspect-auto lg:w-[56%]" : "aspect-[16/9]"}`}>
        {post.coverImage ? (
          // Plain <img>: covers are already resized to ≤1600px WebP on upload.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImage.url}
            alt={post.coverImage.alt}
            loading={featured ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <MaterialIcon name="article" size={48} className="text-[#9cc3ab]" />
          </div>
        )}
      </div>
      <div className={`flex flex-1 flex-col p-5 sm:p-6 ${featured ? "lg:p-10 lg:justify-center" : ""}`}>
        {post.category && (
          <Link
            href={blogCategoryPath(lang, post.category.slug)}
            className="relative z-10 mb-3 self-start rounded-md bg-[#e3f5ea] px-2.5 py-1 text-xs font-semibold text-[#006e2c] hover:bg-[#d2efdd]"
          >
            {post.category.name}
          </Link>
        )}
        <h2
          className={`font-mkt-display font-semibold text-[#101613] leading-snug tracking-tight ${
            featured ? "text-2xl sm:text-3xl lg:text-4xl" : "text-lg sm:text-xl"
          }`}
        >
          <Link href={href} className="after:absolute after:inset-0 focus:outline-none">
            {post.title}
          </Link>
        </h2>
        <p className={`mt-3 text-[#3d4a3d] leading-relaxed ${featured ? "text-base sm:text-lg line-clamp-4" : "text-sm line-clamp-3"}`}>
          {post.excerpt}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-5 text-xs text-[#6b756f]">
          <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt, lang)}</time>
          <span aria-hidden>·</span>
          <span>{t.minRead(post.readingMinutes)}</span>
          <span className="ml-auto inline-flex items-center gap-1 font-semibold text-[#006e2c]">
            {t.readMore}
            <MaterialIcon name="arrow_forward" size={14} />
          </span>
        </div>
      </div>
    </article>
  );
}
