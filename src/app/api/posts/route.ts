import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import dbConnect from "@/lib/mongodb";
import Post from "@/models/Post";
import { requireBusinessContext } from "@/lib/tenant";
import { toFriendlyMessage } from "@/lib/errors/friendlyMessage";

const STATUSES = ["draft", "pending_approval", "approved", "rejected", "scheduled", "publishing", "published", "blocked", "failed", "archived"] as const;

const createPostSchema = z.object({
  title: z.string().trim().max(300).optional().default(""),
  content: z.string().trim().min(1, "Write the post text.").max(1500),
  postType: z.string().trim().max(60).optional(),
  imageBase64: z.string().max(12_000_000).optional(),
  imageMime: z.string().trim().max(40).optional(),
});

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Manual post image. Uses the same geotag policy as weekly post images:
 * GPS already in the file is kept; otherwise the business's verified Google
 * location is written. The phone's current GPS is never accepted here.
 */
async function storeOwnerPostImage(businessId: string, imageBase64: string, imageMime: string) {
  const mime = imageMime.toLowerCase() === "image/jpg" ? "image/jpeg" : imageMime.toLowerCase();
  if (!ALLOWED_IMAGE.has(imageMime.toLowerCase())) {
    throw new Error("Only JPG, PNG, or WebP images are allowed.");
  }
  const raw = imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Image must be 8 MB or smaller.");
  }

  const { getVerifiedBusinessLocation } = await import("@/lib/verifiedLocation");
  const { geotagMedia } = await import("@/lib/imageGeotag");
  const { isStorageConfigured, uploadPublicObject } = await import("@/lib/storage");

  const location = await getVerifiedBusinessLocation(businessId);
  const tagged = await geotagMedia(buffer, mime, location, null);
  const imageUrl = isStorageConfigured()
    ? await uploadPublicObject(tagged.buffer, tagged.mime, `post-thumbnails/${businessId}`)
    : `data:${tagged.mime};base64,${tagged.buffer.toString("base64")}`;
  return { imageUrl, imageGeotag: tagged.geotag };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const businessId = ctx.businessId;

    const filter: Record<string, unknown> = {
      businessId: new mongoose.Types.ObjectId(businessId),
    };
    const status = searchParams.get("status");
    const aiGenerated = searchParams.get("aiGenerated");
    const contentType = searchParams.get("contentType");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10", 10) || 10));
    const skip = (page - 1) * limit;

    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter((s) => (STATUSES as readonly string[]).includes(s));
      if (statuses.length === 0) {
        return NextResponse.json({ message: "Invalid status" }, { status: 400 });
      }
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }
    if (aiGenerated === "true") filter.aiGenerated = true;
    if (contentType) filter.contentType = contentType;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
      ];
    }

    const scheduledOnly = status === "scheduled" || (status ?? "").split(",").includes("scheduled");
    const sort: Record<string, 1 | -1> = scheduledOnly
      ? { scheduledDate: 1, createdAt: -1 }
      : { createdAt: -1 };

    const [posts, total] = await Promise.all([
      Post.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Post.countDocuments(filter),
    ]);

    // `meta=1` adds the real total so clients can show a count without
    // guessing from one page. The default stays a bare array — the history
    // page and the scheduled-count helper already depend on that shape.
    if (searchParams.get("meta") === "1") {
      return NextResponse.json({
        posts,
        total,
        page,
        hasMore: skip + posts.length < total,
      });
    }

    return NextResponse.json(posts);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const parsed = createPostSchema.safeParse(await req.json());
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "Invalid post";
      return NextResponse.json({ message }, { status: 400 });
    }

    const { title, content, postType, imageBase64, imageMime } = parsed.data;
    if (Boolean(imageBase64) !== Boolean(imageMime)) {
      return NextResponse.json({ message: "Image data is incomplete." }, { status: 400 });
    }

    let imageUrl: string | undefined;
    let imageGeotag: unknown;
    let contentMeta: Record<string, unknown> | undefined;
    if (imageBase64 && imageMime) {
      try {
        const stored = await storeOwnerPostImage(ctx.businessId, imageBase64, imageMime);
        imageUrl = stored.imageUrl;
        imageGeotag = stored.imageGeotag;
        contentMeta = { imageOrigin: "OWNER_SELECTED", imageSource: "customer_photo" };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not use that image.";
        return NextResponse.json({ message }, { status: 400 });
      }
    }

    // Always a draft. Publishing and scheduling go through the existing
    // scheduler routes so a manual post uses the same Google write and the
    // same scheduled worker as an automatic post. Callers cannot set
    // businessId, status, or aiGenerated.
    const post = await Post.create({
      title: title || content.slice(0, 80),
      content,
      postType,
      imageUrl,
      imageGeotag,
      contentMeta,
      businessId: ctx.businessId,
      userId: ctx.userId,
      platform: "gmb",
      status: "draft",
      aiGenerated: false,
    });

    return NextResponse.json({ message: "Post created successfully", post }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: toFriendlyMessage(error) }, { status: 500 });
  }
}
