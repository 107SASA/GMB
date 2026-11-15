import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import dbConnect from "@/lib/mongodb";
import Post from "@/models/Post";
import { requireBusinessContext } from "@/lib/tenant";
import { inngest } from "@/services/inngest/client";
import { requireWorkspacePlan } from '@/lib/planGate';
import { LivePostError, pushLivePostEdit, removeLivePost } from "@/services/content/livePost";

/**
 * Fields a client is allowed to change on a post.
 *
 * Everything else — businessId, userId, organizationId, tenantId, publishedAt,
 * aiGenerated, automationMetadata — is deliberately excluded. The previous
 * implementation passed the raw request body straight into findByIdAndUpdate,
 * which let a caller reassign a post to another tenant or forge publish state.
 */
const updatePostSchema = z
  .object({
    title: z.string().max(300).optional(),
    content: z.string().max(20000).optional(),
    media: z.array(z.string()).optional(),
    imageUrl: z.string().optional(),
    thumbnailPrompt: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    location: z.string().optional(),
    tone: z.string().optional(),
    contentType: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    cta: z.string().optional(),
    scheduledDate: z.coerce.date().optional(),
    status: z
      .enum(["draft", "pending_approval", "approved", "rejected", "scheduled", "archived"])
      .optional(),
  })
  .strict();

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Authenticates the caller AND resolves which business they are acting on.
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // Paid feature: this workspace needs its own plan (lib/planGate.ts).
    const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
    if (!planGate.ok) return planGate.response;

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Invalid post id" }, { status: 400 });
    }

    const parsed = updatePostSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request body", errors: parsed.error.issues },
        { status: 400 }
      );
    }

    await dbConnect();

    // Scoped by businessId so one tenant can never touch another's post.
    // A wrong-tenant id is indistinguishable from a missing one (404), so this
    // cannot be used to probe which post ids exist.
    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(id),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ message: "Post not found" }, { status: 404 });
    }

    // A live post: only its text can change, and it changes on Google first
    // (services/content/livePost.ts). Status, schedule and image stay as published.
    if (post.status === "published") {
      const { title, content, hashtags, cta, ...rest } = parsed.data;
      if (Object.keys(rest).length > 0) {
        return NextResponse.json(
          { message: "Only the text of a published post can be changed" },
          { status: 400 }
        );
      }
      if (title !== undefined) post.title = title;
      if (content !== undefined) post.content = content;
      if (hashtags !== undefined) post.hashtags = hashtags;
      if (cta !== undefined) post.cta = cta;
      try {
        if (title !== undefined || content !== undefined) await pushLivePostEdit(post);
      } catch (err) {
        if (err instanceof LivePostError) return NextResponse.json({ message: err.message, code: err.code }, { status: err.status });
        throw err;
      }
      await post.save();
      return NextResponse.json({ message: "Post updated", post });
    }

    const wasScheduled = post.status === "scheduled";
    Object.assign(post, parsed.data);
    await post.save();

    // Keep scheduleSinglePostPublish's sleeping instance in sync with
    // whatever this edit just did to status/scheduledDate.
    if (post.status === "scheduled" && post.scheduledDate) {
      void inngest.send({
        name: "scheduler/post-scheduled",
        data: { postId: post._id.toString(), scheduledDate: post.scheduledDate.toISOString() },
      }).catch((err) => console.error("[posts/id PUT] post-scheduled event failed:", err));
    } else if (wasScheduled && post.status !== "scheduled") {
      void inngest.send({
        name: "scheduler/post-unscheduled",
        data: { postId: post._id.toString() },
      }).catch((err) => console.error("[posts/id PUT] post-unscheduled event failed:", err));
    }

    return NextResponse.json({ message: "Post updated", post });
  } catch (error) {
    console.error("Failed to update post:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // Paid feature: this workspace needs its own plan (lib/planGate.ts).
    const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
    if (!planGate.ok) return planGate.response;

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Invalid post id" }, { status: 400 });
    }

    await dbConnect();

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(id),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ message: "Post not found" }, { status: 404 });
    }

    // Live on Google: removed there first, then here.
    try {
      await removeLivePost(post);
    } catch (err) {
      if (err instanceof LivePostError) return NextResponse.json({ message: err.message, code: err.code }, { status: err.status });
      throw err;
    }

    const wasScheduled = post.status === "scheduled";
    await post.deleteOne();

    if (wasScheduled) {
      void inngest.send({
        name: "scheduler/post-unscheduled",
        data: { postId: id },
      }).catch((err) => console.error("[posts/id DELETE] post-unscheduled event failed:", err));
    }

    return NextResponse.json({ message: "Post deleted" });
  } catch (error) {
    console.error("Failed to delete post:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
