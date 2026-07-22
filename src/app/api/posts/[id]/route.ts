import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import dbConnect from "@/lib/mongodb";
import Post from "@/models/Post";
import { requireBusinessContext } from "@/lib/tenant";

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

    // Matches the guard in /api/scheduler/posts/[id]: once a post is live it is
    // an immutable record of what was published.
    if (post.status === "published") {
      return NextResponse.json(
        { message: "Published posts cannot be edited" },
        { status: 400 }
      );
    }

    Object.assign(post, parsed.data);
    await post.save();

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

    if (post.status === "published") {
      return NextResponse.json(
        { message: "Published posts cannot be deleted" },
        { status: 400 }
      );
    }

    await post.deleteOne();

    return NextResponse.json({ message: "Post deleted" });
  } catch (error) {
    console.error("Failed to delete post:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
