import { NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import BlogPost from "@/models/BlogPost";
import BlogCategory from "@/models/BlogCategory";
import User from "@/models/User";
import { getTemplate } from "@/lib/blog/templates";
import { liveState } from "@/lib/blog/workflow";
import { studioError, logStudioAction } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "in_review", "changes_requested", "scheduled", "published", "archived"];

/** Post list for the Studio (every team member sees every post — it's a shared desk). */
export async function GET(req: Request) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const lang = url.searchParams.get("lang");
    const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
    const mine = url.searchParams.get("mine") === "1";

    const filter: Record<string, unknown> = {};
    if (status === "live") {
      filter.live = { $ne: null };
      filter.status = { $ne: "archived" };
    } else if (status && STATUSES.includes(status)) {
      filter.status = status;
    }
    if (lang === "en" || lang === "hi") filter.language = lang;
    if (mine) filter.createdBy = auth.viewer.userId;
    if (q) filter.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const rows: any[] = await BlogPost.find(filter)
      .select("title slug language status live.slug live.publishedAt live.title categoryId coverImage updatedAt createdBy updatedBy reviewNote submittedAt template translationKey")
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    const userIds = [...new Set(rows.flatMap((r) => [String(r.createdBy), r.updatedBy ? String(r.updatedBy) : ""]).filter(Boolean))];
    const catIds = [...new Set(rows.map((r) => (r.categoryId ? String(r.categoryId) : "")).filter(Boolean))];
    const [users, cats, counts] = await Promise.all([
      User.find({ _id: { $in: userIds } }).select("fullName").lean<any[]>(),
      BlogCategory.find({ _id: { $in: catIds } }).select("name").lean<any[]>(),
      BlogPost.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    const nameOf = new Map(users.map((u) => [String(u._id), u.fullName]));
    const catOf = new Map(cats.map((c) => [String(c._id), c.name?.en]));

    const data = rows.map((r) => ({
      id: String(r._id),
      title: r.title || "(Untitled)",
      slug: r.slug,
      language: r.language,
      status: r.status,
      liveState: liveState(r),
      liveSlug: r.live?.slug || null,
      liveAt: r.live?.publishedAt || null,
      hasUnpublishedChanges: Boolean(r.live) && ["draft", "changes_requested", "in_review"].includes(r.status),
      category: r.categoryId ? catOf.get(String(r.categoryId)) || null : null,
      coverUrl: r.coverImage?.url || null,
      updatedAt: r.updatedAt,
      createdBy: nameOf.get(String(r.createdBy)) || "—",
      updatedBy: r.updatedBy ? nameOf.get(String(r.updatedBy)) || "—" : null,
      reviewNote: r.reviewNote || null,
      submittedAt: r.submittedAt || null,
      template: r.template,
    }));
    const byStatus = Object.fromEntries(counts.map((c: any) => [c._id, c.n]));
    return NextResponse.json({ success: true, data, counts: byStatus });
  } catch (err) {
    return studioError(err, "list posts");
  }
}

/** New post from a template. Body: { template, language, translationOf? } */
export async function POST(req: Request) {
  const auth = await requireStudioApi("blog");
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const tpl = getTemplate(String(body?.template || "custom"));
    const language = body?.language === "hi" ? "hi" : "en";

    // Starting a translation of an existing post: share its translation key
    // and copy its cover image, topic and design so the writer only translates text.
    let translationKey = new mongoose.Types.ObjectId().toString();
    let copied: Record<string, unknown> = {};
    if (body?.translationOf && mongoose.Types.ObjectId.isValid(String(body.translationOf))) {
      const twin = await BlogPost.findById(body.translationOf).lean<any>();
      if (twin && twin.language !== language) {
        if (await BlogPost.exists({ language, translationKey: twin.translationKey })) {
          return NextResponse.json({ success: false, error: "That post already has a translation in this language." }, { status: 409 });
        }
        translationKey = twin.translationKey;
        copied = {
          coverImage: twin.coverImage,
          categoryId: twin.categoryId,
          design: twin.design,
          slug: twin.slug,
          template: twin.template,
        };
      }
    }

    const post = await BlogPost.create({
      language,
      translationKey,
      template: tpl.id,
      title: "",
      slug: "",
      excerpt: "",
      contentHtml: tpl.body[language],
      faqs: tpl.faqs[language],
      design: { layout: tpl.layout, showToc: tpl.showToc, cta: { type: tpl.cta } },
      createdBy: auth.viewer.userId,
      updatedBy: auth.viewer.userId,
      ...copied,
    });
    // A copied slug is shared across languages on purpose (/blog/x ↔ /hi/blog/x);
    // it only has to be unique within one language.
    if (copied.slug && (await BlogPost.exists({ _id: { $ne: post._id }, language, $or: [{ slug: copied.slug }, { "live.slug": copied.slug }] }))) {
      await BlogPost.updateOne({ _id: post._id }, { $set: { slug: "" } });
    }
    await logStudioAction(auth.viewer, "blog.create", { postId: String(post._id), template: tpl.id, language });
    return NextResponse.json({ success: true, data: { id: String(post._id) } });
  } catch (err) {
    return studioError(err, "create post");
  }
}
