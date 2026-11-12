import type { Metadata } from "next";
import { notFound } from "next/navigation";
import dbConnect from "@/lib/mongodb";
import { studioViewerFor } from "@/lib/studioAuth";
import BlogPost from "@/models/BlogPost";
import BlogCategory from "@/models/BlogCategory";
import { cleanBlogHtml } from "@/lib/blog/sanitize";
import { ArticleView } from "@/components/blog/ArticleView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/**
 * Studio preview of a post's WORKING copy (what the writer is editing, not
 * what is live) using the real public article layout. Staff with blog access only.
 */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await studioViewerFor("blog");
  if (!viewer) notFound();
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  await dbConnect();
  const p: any = await BlogPost.findById(id).lean();
  if (!p) notFound();
  const cat: any = p.categoryId ? await BlogCategory.findById(p.categoryId).lean() : null;
  const twin: any = await BlogPost.findOne({ _id: { $ne: p._id }, translationKey: p.translationKey, live: { $ne: null } })
    .select("live.slug")
    .lean();
  const clean = cleanBlogHtml(p.contentHtml || "", p.language);
  const now = new Date().toISOString();
  return (
    <ArticleView
      preview
      post={{
        language: p.language,
        slug: p.slug || "preview",
        title: p.title || "(Untitled post)",
        excerpt: p.excerpt || "",
        contentHtml: clean.html,
        coverImage: p.coverImage?.url ? p.coverImage : undefined,
        publishedAt: p.live?.publishedAt ? new Date(p.live.publishedAt).toISOString() : now,
        updatedAt: now,
        readingMinutes: clean.readingMinutes,
        category: cat
          ? { id: String(cat._id), slug: cat.slug, name: (p.language === "hi" && cat.name?.hi) || cat.name?.en }
          : null,
        tags: p.tags || [],
        toc: clean.toc,
        faqs: (p.faqs || []).filter((f: any) => f.question && f.answer),
        design: p.design || { layout: "standard", showToc: true, cta: { type: "free_report" } },
        translationSlug: twin?.live?.slug || null,
      }}
    />
  );
}
