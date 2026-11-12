import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import BlogCategory from "@/models/BlogCategory";
import BlogPost from "@/models/BlogPost";
import { cleanText } from "@/lib/blog/sanitize";
import { slugify, RESERVED_SLUGS } from "@/lib/blog/shared";
import { studioError, logStudioAction } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const [cats, usage] = await Promise.all([
      BlogCategory.find().sort({ order: 1, "name.en": 1 }).lean<any[]>(),
      BlogPost.aggregate([{ $match: { categoryId: { $ne: null } } }, { $group: { _id: "$categoryId", n: { $sum: 1 } } }]),
    ]);
    const used = new Map(usage.map((u: any) => [String(u._id), u.n]));
    return NextResponse.json({
      success: true,
      data: cats.map((c) => ({
        id: String(c._id),
        slug: c.slug,
        name: c.name,
        description: c.description || {},
        order: c.order || 0,
        posts: used.get(String(c._id)) || 0,
      })),
    });
  } catch (err) {
    return studioError(err, "list categories");
  }
}

/** Body: { nameEn, nameHi?, descriptionEn?, descriptionHi?, slug? } */
export async function POST(req: Request) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const nameEn = cleanText(body?.nameEn, 80);
    if (!nameEn) return NextResponse.json({ success: false, error: "Enter the topic name in English." }, { status: 400 });
    const slug = slugify(String(body?.slug || nameEn)).slice(0, 80);
    if (!slug || RESERVED_SLUGS.has(slug)) {
      return NextResponse.json({ success: false, error: "Choose a different web address for this topic." }, { status: 400 });
    }
    if (await BlogCategory.exists({ slug })) {
      return NextResponse.json({ success: false, error: "A topic with this web address already exists." }, { status: 409 });
    }
    const count = await BlogCategory.countDocuments();
    const cat = await BlogCategory.create({
      slug,
      name: { en: nameEn, hi: cleanText(body?.nameHi, 80) || undefined },
      description: { en: cleanText(body?.descriptionEn, 300) || undefined, hi: cleanText(body?.descriptionHi, 300) || undefined },
      order: count,
    });
    await logStudioAction(auth.viewer, "blog.category_create", { categoryId: String(cat._id), slug });
    return NextResponse.json({ success: true, data: { id: String(cat._id), slug } });
  } catch (err) {
    return studioError(err, "create category");
  }
}
