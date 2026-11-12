import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import BlogRevision from "@/models/BlogRevision";
import User from "@/models/User";
import { restoreRevision } from "@/lib/blog/workflow";
import { studioError, logStudioAction, isObjectId } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Version history of a post (newest first). */
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    await dbConnect();
    const rows: any[] = await BlogRevision.find({ postId: id })
      .select("reason createdAt createdBy snapshot.title snapshot.contentHtml")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.createdBy)))] } })
      .select("fullName")
      .lean<any[]>();
    const nameOf = new Map(users.map((u) => [String(u._id), u.fullName]));
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: String(r._id),
        reason: r.reason,
        createdAt: r.createdAt,
        by: nameOf.get(String(r.createdBy)) || "—",
        title: r.snapshot?.title || "(Untitled)",
        words: String(r.snapshot?.contentHtml || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
      })),
    });
  } catch (err) {
    return studioError(err, "list revisions");
  }
}

/** Restore a version into the working copy. Body: { revisionId } */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const post = await restoreRevision(id, String(body?.revisionId || ""), auth.viewer);
    await logStudioAction(auth.viewer, "blog.restore_version", { postId: id, revisionId: body?.revisionId });
    return NextResponse.json({ success: true, data: { editVersion: post.editVersion } });
  } catch (err) {
    return studioError(err, "restore revision");
  }
}
