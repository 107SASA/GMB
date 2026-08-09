import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Post from "@/models/Post";
import Business from "@/models/Business";
import { generatePost } from "@/services/ai";
import { requireBusinessContext } from "@/lib/tenant";

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const businessId = ctx.businessId;

    const filter: any = { businessId };
    const status = searchParams.get("status");
    const aiGenerated = searchParams.get("aiGenerated");
    const contentType = searchParams.get("contentType");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;
    
    if (status) filter.status = status;
    if (aiGenerated === "true") filter.aiGenerated = true;
    if (contentType) filter.contentType = contentType;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } }
      ];
    }

    const posts = await Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
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

    const body = await req.json();

    // Pre-existing bug found while wiring this up for the first real caller
    // (mobile's manual "create post" form) — nothing on the web called this
    // route before, so it went unnoticed: the Post schema's status enum is
    // lowercase ('draft'|'pending_approval'|...), but this defaulted to the
    // uppercase "PENDING_APPROVAL", which Mongoose's enum validator rejects.
    // Every manual-create call that didn't explicitly pass a status would
    // have thrown a ValidationError.
    const post = await Post.create({
      ...body,
      businessId: ctx.businessId,
      status: body.status || "draft",
    });

    return NextResponse.json({ message: "Post created successfully", post }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
