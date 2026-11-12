import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import {
  submitForReview,
  withdraw,
  approve,
  requestChanges,
  takeDown,
  restoreLive,
  discardChanges,
  WorkflowError,
} from "@/lib/blog/workflow";
import { notifySubmitted, notifyReviewed } from "@/lib/studio/notify";
import { studioError, logStudioAction, isObjectId } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const SUPER_ONLY = new Set(["approve", "request_changes", "take_down", "restore"]);

/**
 * Workflow buttons in the editor.
 * Body: { action: 'submit' | 'withdraw' | 'discard' | 'approve' | 'request_changes' | 'take_down' | 'restore',
 *         publishAt?: ISO string (approve), note?: string (request_changes) }
 */
export async function POST(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const auth = await requireStudioApi(SUPER_ONLY.has(action) ? "super_admin" : "blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Post not found" }, { status: 404 });
    await dbConnect();
    const v = auth.viewer;
    const editPath = `/studio/blog/${id}`;
    let post;

    switch (action) {
      case "submit":
        post = await submitForReview(id, v);
        if (!v.isSuperAdmin) {
          await notifySubmitted({ kind: "post", title: post.title, byName: v.fullName || v.email, reviewPath: editPath });
        }
        break;
      case "withdraw":
        post = await withdraw(id);
        break;
      case "discard":
        post = await discardChanges(id);
        break;
      case "approve": {
        let publishAt: Date | null = null;
        if (body?.publishAt) {
          publishAt = new Date(String(body.publishAt));
          if (Number.isNaN(publishAt.getTime())) throw new WorkflowError("Pick a valid date and time.");
        }
        post = await approve(id, v, publishAt);
        if (post.submittedBy && String(post.submittedBy) !== v.userId) {
          const scheduled = post.status === "scheduled";
          await notifyReviewed({
            submittedBy: post.submittedBy,
            title: post.title,
            outcome: scheduled ? "scheduled" : "published",
            when: scheduled && post.live
              ? new Date(post.live.publishedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
              : undefined,
            editPath,
          });
        }
        break;
      }
      case "request_changes":
        post = await requestChanges(id, v, String(body?.note || ""));
        if (post.submittedBy) {
          await notifyReviewed({ submittedBy: post.submittedBy, title: post.title, outcome: "changes_requested", note: post.reviewNote, editPath });
        }
        break;
      case "take_down":
        post = await takeDown(id, v);
        break;
      case "restore":
        post = await restoreLive(id, v);
        break;
      default:
        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }

    await logStudioAction(v, `blog.${action}`, { postId: id, title: post.title, status: post.status });
    return NextResponse.json({ success: true, data: { status: post.status, editVersion: post.editVersion } });
  } catch (err) {
    return studioError(err, `post action ${action}`);
  }
}
