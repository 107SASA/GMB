import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import BlogCategory from "@/models/BlogCategory";
import BlogPost from "@/models/BlogPost";
import { cleanText } from "@/lib/blog/sanitize";
import { studioError, logStudioAction, isObjectId } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Rename a topic. The web address (slug) is fixed once created so live topic
 * pages never move. Topic names show on the website straight away (they are
 * labels, not content), so this is Super Admin only.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("super_admin");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Topic not found" }, { status: 404 });
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const nameEn = cleanText(body?.nameEn, 80);
    if (!nameEn) return NextResponse.json({ success: false, error: "Enter the topic name in English." }, { status: 400 });
    const cat = await BlogCategory.findByIdAndUpdate(
      id,
      {
        $set: {
          "name.en": nameEn,
          "name.hi": cleanText(body?.nameHi, 80) || undefined,
          "description.en": cleanText(body?.descriptionEn, 300) || undefined,
          "description.hi": cleanText(body?.descriptionHi, 300) || undefined,
        },
      },
      { new: true }
    ).lean<any>();
    if (!cat) return NextResponse.json({ success: false, error: "Topic not found" }, { status: 404 });
    for (const base of ["/blog", "/hi/blog"]) {
      revalidatePath(base);
      revalidatePath(`${base}/category/${cat.slug}`);
      revalidatePath(`${base}/[slug]`, "page");
    }
    await logStudioAction(auth.viewer, "blog.category_update", { categoryId: id });
    return NextResponse.json({ success: true });
  } catch (err) {
    return studioError(err, "update category");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isObjectId(id)) return NextResponse.json({ success: false, error: "Topic not found" }, { status: 404 });
    await dbConnect();
    const inUse = await BlogPost.exists({ $or: [{ categoryId: id }, { "live.categoryId": id }] });
    if (inUse) {
      return NextResponse.json(
        { success: false, error: "Some posts use this topic. Move them to another topic first." },
        { status: 409 }
      );
    }
    await BlogCategory.deleteOne({ _id: id });
    await logStudioAction(auth.viewer, "blog.category_delete", { categoryId: id });
    return NextResponse.json({ success: true });
  } catch (err) {
    return studioError(err, "delete category");
  }
}
