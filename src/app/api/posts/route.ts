import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Post from "@/models/Post";
import { DEV_CONTEXT } from "@/lib/dev-context";
import Business from "@/models/Business";
import { generatePost } from "@/services/ai";

export async function GET(req: Request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(req.url);
    const businessId = DEV_CONTEXT.businessId;

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
    await dbConnect();
    
    const body = await req.json();

    const post = await Post.create({
      ...body,
      businessId: DEV_CONTEXT.businessId,
      status: body.status || "PENDING_APPROVAL",
    });

    return NextResponse.json({ message: "Post created successfully", post }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
