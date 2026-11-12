import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import BlogPost from "@/models/BlogPost";
import BlogRevision from "@/models/BlogRevision";
import User from "@/models/User";
import { canEdit, liveState, saveWorkingCopy, revalidatePost } from "@/lib/blog/workflow";
import { studioError, logStudioAction, isObjectId } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function view(p: any, viewer: { isSuperAdmin: boolean }, extra: Record<string, unknown> = {}) {
  return {
    id: String(p._id),
    language: p.language,
    translationKey: p.translationKey,
    template: p.template,
    status: p.status,
    liveState: liveState(p),
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt,
    contentHtml: p.contentHtml,
    coverImage: p.coverImage || null,
    categoryId: p.categoryId ? String(p.categoryId) : null,
    tags: p.tags || [],
    seo: p.seo || {},
    faqs: p.faqs || [],
    design: p.design || { layout: "standard", showToc: true, cta: { type: "free_report" } },
    live: p.live ? { slug: p.live.slug, title: p.live.title, publishedAt: p.live.publishedAt, updatedAt: p.live.updatedAt } : null,
    firstPublishedAt: p.firstPublishedAt || null,
    reviewNote: p.reviewNote || null,
    submittedAt: p.submittedAt || null,
    editVersion: p.editVersion,
    updatedAt: p.updatedAt,
    canEdit: canEdit(p, viewer as any),
    canPublish: viewer.isSuperAdmin,
    ...extra,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    await dbConnect();
    const post: any = await BlogPost.findById(id).lean();
    if (!post) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    const [twin, submitter, updater] = await Promise.all([
      BlogPost.findOne({ _id: { $ne: post._id }, translationKey: post.translationKey })
        .select("title language status live.slug")
        .lean<any>(),
      post.submittedBy ? User.findById(post.submittedBy).select("fullName").lean<any>() : null,
      post.updatedBy ? User.findById(post.updatedBy).select("fullName").lean<any>() : null,
    ]);
    return NextResponse.json({
      success: true,
      data: view(post, auth.viewer, {
        translation: twin
          ? { id: String(twin._id), title: twin.title || "(Untitled)", language: twin.language, status: twin.status }
          : null,
        submittedBy: submitter?.fullName || null,
        updatedBy: updater?.fullName || null,
      }),
    });
  } catch (err) {
    return studioError(err, "get post");
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const updated = await saveWorkingCopy(id, body, auth.viewer);
    return NextResponse.json({ success: true, data: view(updated.toObject(), auth.viewer) });
  } catch (err) {
    return studioError(err, "save post");
  }
}

/**
 * Delete. A post that has never been on the website can be deleted by its
 * writer or a Super Admin; anything that has been live is Super Admin only
 * (and it is taken off the site first).
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    await dbConnect();
    const post: any = await BlogPost.findById(id).lean();
    if (!post) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    const everLive = Boolean(post.live || post.firstPublishedAt);
    if (everLive && !auth.viewer.isSuperAdmin) {
      return NextResponse.json({ success: false, error: "Only a Super Admin can delete a post that has been published." }, { status: 403 });
    }
    if (!everLive && !auth.viewer.isSuperAdmin && String(post.createdBy) !== auth.viewer.userId) {
      return NextResponse.json({ success: false, error: "You can only delete drafts you created." }, { status: 403 });
    }
    await BlogPost.deleteOne({ _id: id });
    await BlogRevision.deleteMany({ postId: id });
    if (post.live) await revalidatePost(post.language, post.live, post.previousSlugs || []);
    await logStudioAction(auth.viewer, "blog.delete", { postId: id, title: post.title });
    return NextResponse.json({ success: true });
  } catch (err) {
    return studioError(err, "delete post");
  }
}
