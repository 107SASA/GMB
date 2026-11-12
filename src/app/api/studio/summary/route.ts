import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import BlogPost from "@/models/BlogPost";
import SitePageContent from "@/models/SitePageContent";
import User from "@/models/User";
import { getCmsPage } from "@/lib/cms/pages";
import { studioError } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

/**
 * Studio home + the "waiting for approval" queue. Also polled by the Super
 * Admin sidebar for its badge (?count=1 returns just the number).
 */
export async function GET(req: Request) {
  const auth = await requireStudioApi("any");
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const v = auth.viewer;
    const canBlog = v.permissions.includes("blog");
    const canCms = v.permissions.includes("cms");

    if (new URL(req.url).searchParams.get("count") === "1") {
      const [posts, pages] = await Promise.all([
        canBlog ? BlogPost.countDocuments({ status: "in_review" }) : 0,
        canCms ? SitePageContent.countDocuments({ status: "in_review" }) : 0,
      ]);
      return NextResponse.json({ success: true, data: { waiting: posts + pages } });
    }

    const [reviewPosts, reviewPages, myChanges, livePosts, drafts, scheduled] = await Promise.all([
      canBlog
        ? BlogPost.find({ status: "in_review" }).select("title language submittedAt submittedBy").sort({ submittedAt: 1 }).limit(50).lean<any[]>()
        : [],
      canCms
        ? SitePageContent.find({ status: "in_review" }).select("pageKey submittedAt submittedBy").sort({ submittedAt: 1 }).lean<any[]>()
        : [],
      canBlog
        ? BlogPost.find({ status: "changes_requested", ...(v.isSuperAdmin ? {} : { submittedBy: v.userId }) })
            .select("title reviewNote updatedAt")
            .sort({ updatedAt: -1 })
            .limit(20)
            .lean<any[]>()
        : [],
      canBlog ? BlogPost.countDocuments({ live: { $ne: null }, status: { $ne: "archived" }, "live.publishedAt": { $lte: new Date() } }) : 0,
      canBlog ? BlogPost.countDocuments({ status: "draft" }) : 0,
      canBlog ? BlogPost.countDocuments({ status: "scheduled" }) : 0,
    ]);

    const ids = [...reviewPosts, ...reviewPages].map((r) => r.submittedBy).filter(Boolean).map(String);
    const users = await User.find({ _id: { $in: [...new Set(ids)] } }).select("fullName").lean<any[]>();
    const nameOf = new Map(users.map((u) => [String(u._id), u.fullName]));

    const queue = [
      ...reviewPosts.map((p) => ({
        kind: "post" as const,
        id: String(p._id),
        title: p.title || "(Untitled)",
        language: p.language,
        by: nameOf.get(String(p.submittedBy)) || "—",
        submittedAt: p.submittedAt,
        href: `/studio/blog/${p._id}`,
      })),
      ...reviewPages.map((p) => ({
        kind: "page" as const,
        id: p.pageKey,
        title: getCmsPage(p.pageKey)?.label || p.pageKey,
        language: null,
        by: nameOf.get(String(p.submittedBy)) || "—",
        submittedAt: p.submittedAt,
        href: `/studio/pages/${p.pageKey}`,
      })),
    ].sort((a, b) => new Date(a.submittedAt || 0).getTime() - new Date(b.submittedAt || 0).getTime());

    return NextResponse.json({
      success: true,
      data: {
        viewer: { name: v.fullName, isSuperAdmin: v.isSuperAdmin, permissions: v.permissions },
        queue,
        changesRequested: myChanges.map((p) => ({ id: String(p._id), title: p.title || "(Untitled)", note: p.reviewNote, updatedAt: p.updatedAt })),
        stats: { livePosts, drafts, scheduled, waiting: queue.length },
      },
    });
  } catch (err) {
    return studioError(err, "summary");
  }
}
