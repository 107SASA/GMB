import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import BlogPost, { type IBlogPost, type IBlogLive, type IBlogContent, type BlogLanguage } from "@/models/BlogPost";
import BlogCategory from "@/models/BlogCategory";
import BlogRevision from "@/models/BlogRevision";
import { cleanBlogHtml, cleanText, cleanLink, cleanImageUrl } from "@/lib/blog/sanitize";
import {
  blogHomePath,
  blogPostPath,
  blogCategoryPath,
  isValidSlug,
  RESERVED_SLUGS,
  runSeoChecks,
  slugify,
} from "@/lib/blog/shared";
import type { StudioViewer } from "@/lib/studioAuth";

/**
 * Blog post workflow (server). Every write to a post goes through here so the
 * rules live in one place:
 *  - team members change only the working copy;
 *  - only a Super Admin writes `live` (approve / take down / restore);
 *  - public pages are rebuilt (revalidatePath) whenever `live` changes.
 */

export class WorkflowError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

// ---------- input cleaning ----------

type Input = Record<string, any>;

/** Turns an editor payload into clean working-copy fields. Only fields present in `body` are returned. */
export async function cleanEditorInput(body: Input, lang: BlogLanguage): Promise<Partial<IBlogContent>> {
  const out: Partial<IBlogContent> = {};
  if ("title" in body) out.title = cleanText(body.title, 200);
  if ("slug" in body) out.slug = slugify(String(body.slug || "")).slice(0, 100);
  if ("excerpt" in body) out.excerpt = cleanText(body.excerpt, 400);
  if ("contentHtml" in body) out.contentHtml = cleanBlogHtml(String(body.contentHtml || ""), lang).html;
  if ("coverImage" in body) {
    const url = cleanImageUrl(body.coverImage?.url);
    const w = Number(body.coverImage?.width);
    const h = Number(body.coverImage?.height);
    out.coverImage = url
      ? {
          url,
          alt: cleanText(body.coverImage?.alt, 200),
          ...(w > 0 && h > 0 ? { width: Math.round(w), height: Math.round(h) } : {}),
        }
      : undefined;
  }
  if ("categoryId" in body) {
    const id = body.categoryId;
    if (id && mongoose.Types.ObjectId.isValid(String(id)) && (await BlogCategory.exists({ _id: id }))) {
      out.categoryId = new mongoose.Types.ObjectId(String(id));
    } else {
      out.categoryId = null;
    }
  }
  if ("tags" in body) {
    out.tags = [
      ...new Set(
        (Array.isArray(body.tags) ? body.tags : [])
          .map((t: unknown) => cleanText(t, 40))
          .filter(Boolean)
      ),
    ].slice(0, 12) as string[];
  }
  if ("seo" in body) {
    const s = body.seo || {};
    out.seo = {
      title: cleanText(s.title, 120),
      description: cleanText(s.description, 320),
      focusKeyword: cleanText(s.focusKeyword, 100),
      ogImageUrl: cleanImageUrl(s.ogImageUrl),
      noindex: Boolean(s.noindex),
    };
  }
  if ("faqs" in body) {
    out.faqs = (Array.isArray(body.faqs) ? body.faqs : [])
      .map((f: any) => ({ question: cleanText(f?.question, 300), answer: cleanText(f?.answer, 2000) }))
      .filter((f: { question: string; answer: string }) => f.question || f.answer)
      .slice(0, 20);
  }
  if ("design" in body) {
    const d = body.design || {};
    const ctaType = ["free_report", "book_demo", "custom", "none"].includes(d.cta?.type) ? d.cta.type : "free_report";
    out.design = {
      layout: ["standard", "wide", "minimal"].includes(d.layout) ? d.layout : "standard",
      showToc: d.showToc !== false,
      cta: {
        type: ctaType,
        ...(ctaType === "custom"
          ? {
              heading: cleanText(d.cta?.heading, 120),
              text: cleanText(d.cta?.text, 300),
              buttonLabel: cleanText(d.cta?.buttonLabel, 40),
              buttonUrl: cleanLink(d.cta?.buttonUrl),
            }
          : {}),
      },
    };
  }
  return out;
}

/** True if no OTHER post in this language uses `slug` (working or live) or used it before. */
export async function isSlugFree(lang: BlogLanguage, slug: string, excludeId?: unknown): Promise<boolean> {
  const filter: Record<string, unknown> = {
    language: lang,
    $or: [{ slug }, { "live.slug": slug }, { previousSlugs: slug }],
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return !(await BlogPost.exists(filter));
}

/** A free slug based on `base` (adds -2, -3 … if needed). */
export async function uniqueSlug(lang: BlogLanguage, base: string, excludeId?: unknown): Promise<string> {
  const root = (slugify(base) || "post").slice(0, 90);
  let slug = RESERVED_SLUGS.has(root) ? `${root}-post` : root;
  for (let n = 2; !(await isSlugFree(lang, slug, excludeId)); n++) slug = `${root}-${n}`;
  return slug;
}

// ---------- revisions ----------

function contentSnapshot(p: IBlogPost) {
  return {
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt,
    contentHtml: p.contentHtml,
    coverImage: p.coverImage,
    categoryId: p.categoryId,
    tags: p.tags,
    seo: p.seo,
    faqs: p.faqs,
    design: p.design,
  };
}

async function saveRevision(p: IBlogPost, reason: "submitted" | "published" | "restored", byUserId: string) {
  try {
    await BlogRevision.create({ postId: p._id, reason, snapshot: contentSnapshot(p), createdBy: byUserId });
    // Keep the newest 30 per post.
    const old = await BlogRevision.find({ postId: p._id }).sort({ createdAt: -1 }).skip(30).select("_id").lean();
    if (old.length) await BlogRevision.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  } catch (err: any) {
    console.error("[blog] revision save failed:", err?.message);
  }
}

// ---------- page rebuilds ----------

async function categorySlug(id: unknown): Promise<string | null> {
  if (!id) return null;
  const c = await BlogCategory.findById(id).select("slug").lean<{ slug?: string }>();
  return c?.slug || null;
}

/** Rebuild every public page that shows this post (old + new address, lists, topics, sitemap, feed). */
export async function revalidatePost(lang: BlogLanguage, live: { slug?: string; categoryId?: unknown } | null | undefined, extraSlugs: string[] = []) {
  const paths = new Set<string>([blogHomePath(lang), "/sitemap.xml", `${blogHomePath(lang)}/rss.xml`]);
  if (live?.slug) paths.add(blogPostPath(lang, live.slug));
  for (const s of extraSlugs) if (s) paths.add(blogPostPath(lang, s));
  const cat = await categorySlug(live?.categoryId);
  if (cat) paths.add(blogCategoryPath(lang, cat));
  // The other language's article links here through hreflang — rebuild it too.
  paths.add(blogHomePath(lang === "en" ? "hi" : "en"));
  try {
    for (const p of paths) revalidatePath(p);
    revalidatePath(`${blogHomePath(lang)}/page/[page]`, "page");
    revalidatePath(`${blogHomePath(lang)}/[slug]`, "page");
  } catch (err: any) {
    console.error("[blog] revalidate failed:", err?.message);
  }
}

// ---------- state helpers ----------

export type LiveState = "none" | "scheduled" | "live" | "archived";
export function liveState(p: Pick<IBlogPost, "status" | "live">): LiveState {
  if (!p.live) return "none";
  if (p.status === "archived") return "archived";
  return new Date(p.live.publishedAt) > new Date() ? "scheduled" : "live";
}

const isTeamEditable = (status: IBlogPost["status"]) =>
  status === "draft" || status === "changes_requested" || status === "published" || status === "scheduled";

export function canEdit(p: IBlogPost, viewer: StudioViewer): boolean {
  if (viewer.isSuperAdmin) return true;
  return isTeamEditable(p.status);
}

// ---------- actions ----------

/** Save the working copy. `editVersion` must match, so two people can't overwrite each other silently. */
export async function saveWorkingCopy(id: string, body: Input, viewer: StudioViewer) {
  const post = await BlogPost.findById(id);
  if (!post) throw new WorkflowError("Post not found", 404);
  if (!canEdit(post, viewer)) {
    throw new WorkflowError(
      post.status === "in_review"
        ? "This post is waiting for approval. Click “Withdraw” to edit it again."
        : "This post can't be edited right now.",
      409
    );
  }
  if (typeof body.editVersion === "number" && body.editVersion !== post.editVersion) {
    throw new WorkflowError("Someone else saved this post a moment ago. Reload the page to see their changes.", 409, "STALE");
  }

  // Language can change only until the post has been live once.
  let lang = post.language;
  if ((body.language === "en" || body.language === "hi") && body.language !== post.language) {
    if (post.live || post.firstPublishedAt) throw new WorkflowError("The language of a published post can't be changed.");
    lang = body.language;
  }

  const fields = await cleanEditorInput(body, lang);
  if (fields.slug !== undefined && fields.slug && !(await isSlugFree(lang, fields.slug, post._id))) {
    throw new WorkflowError("Another post already uses this web address. Please change it.", 409, "SLUG_TAKEN");
  }

  // Pair with the same article in the other language.
  const set: Record<string, unknown> = { ...fields, language: lang, updatedBy: viewer.userId };
  if ("translationOf" in body) {
    if (!body.translationOf) {
      set.translationKey = new mongoose.Types.ObjectId().toString();
    } else if (mongoose.Types.ObjectId.isValid(String(body.translationOf))) {
      const twin = await BlogPost.findById(body.translationOf).select("language translationKey").lean<any>();
      if (!twin || twin.language === lang) throw new WorkflowError("Pick a post in the other language.");
      const clash = await BlogPost.exists({ _id: { $ne: post._id }, language: lang, translationKey: twin.translationKey });
      if (clash) throw new WorkflowError("That post already has a translation in this language.");
      set.translationKey = twin.translationKey;
    }
  }
  if (post.status === "published" || post.status === "scheduled") set.status = "draft";

  const updated = await BlogPost.findOneAndUpdate(
    { _id: post._id, editVersion: post.editVersion },
    { $set: set, $inc: { editVersion: 1 } },
    { new: true }
  );
  if (!updated) throw new WorkflowError("Someone else saved this post a moment ago. Reload the page to see their changes.", 409, "STALE");
  return updated;
}

export async function submitForReview(id: string, viewer: StudioViewer) {
  const post = await BlogPost.findById(id);
  if (!post) throw new WorkflowError("Post not found", 404);
  if (!["draft", "changes_requested"].includes(post.status)) {
    throw new WorkflowError(post.status === "in_review" ? "Already waiting for approval." : "There are no new changes to submit.");
  }
  const failing = runSeoChecks({ ...post.toObject(), language: post.language }).filter((c) => c.blocking && c.status === "bad");
  if (failing.length) {
    throw new WorkflowError(`Before submitting: ${failing.map((c) => c.hint).join(" ")}`, 422, "CHECKS");
  }
  if (!(await isSlugFree(post.language, post.slug, post._id))) {
    throw new WorkflowError("Another post already uses this web address. Please change it.", 409, "SLUG_TAKEN");
  }
  post.status = "in_review";
  post.submittedAt = new Date();
  post.submittedBy = new mongoose.Types.ObjectId(viewer.userId);
  post.reviewNote = undefined;
  post.editVersion += 1;
  await post.save();
  await saveRevision(post, "submitted", viewer.userId);
  return post;
}

export async function withdraw(id: string) {
  const post = await BlogPost.findOneAndUpdate(
    { _id: id, status: "in_review" },
    { $set: { status: "draft" }, $inc: { editVersion: 1 } },
    { new: true }
  );
  if (!post) throw new WorkflowError("This post is not waiting for approval.");
  return post;
}

/** Super Admin: make the working copy live now, or at `publishAt`. */
export async function approve(id: string, viewer: StudioViewer, publishAt?: Date | null) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can publish.", 403);
  const post = await BlogPost.findById(id);
  if (!post) throw new WorkflowError("Post not found", 404);

  const checks = runSeoChecks({ ...post.toObject(), language: post.language }).filter((c) => c.blocking && c.status === "bad");
  if (checks.length) throw new WorkflowError(`Can't publish yet: ${checks.map((c) => c.hint).join(" ")}`, 422, "CHECKS");
  if (!(await isSlugFree(post.language, post.slug, post._id))) {
    throw new WorkflowError("Another post already uses this web address.", 409, "SLUG_TAKEN");
  }

  const now = new Date();
  const wasLive = liveState(post) === "live";
  const future = publishAt && publishAt.getTime() > now.getTime() + 60_000 ? publishAt : null;
  if (future && wasLive) {
    throw new WorkflowError("This post is already live — updates go live straight away and can't be scheduled.");
  }

  const clean = cleanBlogHtml(post.contentHtml, post.language);
  const oldLive = post.live ? { slug: post.live.slug, categoryId: post.live.categoryId } : null;
  const live: IBlogLive = {
    ...contentSnapshot(post),
    contentHtml: clean.html,
    toc: clean.toc,
    wordCount: clean.wordCount,
    readingMinutes: clean.readingMinutes,
    // Keep the original publish date when updating a live post.
    publishedAt: future || (wasLive && post.live ? post.live.publishedAt : now),
    updatedAt: now,
  } as IBlogLive;

  const previousSlugs = new Set(post.previousSlugs || []);
  if (oldLive?.slug && oldLive.slug !== post.slug && wasLive) previousSlugs.add(oldLive.slug);
  previousSlugs.delete(post.slug);

  post.live = live;
  post.contentHtml = clean.html;
  post.previousSlugs = [...previousSlugs];
  post.status = future ? "scheduled" : "published";
  post.firstPublishedAt = post.firstPublishedAt || (future ? future : now);
  post.reviewedAt = now;
  post.reviewedBy = new mongoose.Types.ObjectId(viewer.userId);
  post.reviewNote = undefined;
  post.editVersion += 1;
  await post.save();
  await saveRevision(post, "published", viewer.userId);

  await revalidatePost(post.language, live, oldLive?.slug && oldLive.slug !== live.slug ? [oldLive.slug] : []);
  if (oldLive?.categoryId && String(oldLive.categoryId) !== String(live.categoryId)) {
    await revalidatePost(post.language, { categoryId: oldLive.categoryId });
  }
  return post;
}

export async function requestChanges(id: string, viewer: StudioViewer, note: string) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can do this.", 403);
  const text = cleanText(note, 2000);
  if (!text) throw new WorkflowError("Write a short note so the writer knows what to change.");
  const post = await BlogPost.findOneAndUpdate(
    { _id: id, status: { $in: ["in_review", "draft"] } },
    {
      $set: { status: "changes_requested", reviewNote: text, reviewedAt: new Date(), reviewedBy: viewer.userId },
      $inc: { editVersion: 1 },
    },
    { new: true }
  );
  if (!post) throw new WorkflowError("This post is not waiting for approval.");
  return post;
}

/** Super Admin: take a post off the website (kept, can be restored). */
export async function takeDown(id: string, viewer: StudioViewer) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can do this.", 403);
  const post = await BlogPost.findById(id);
  if (!post) throw new WorkflowError("Post not found", 404);
  if (!post.live) throw new WorkflowError("This post is not on the website.");
  post.status = "archived";
  post.editVersion += 1;
  await post.save();
  await revalidatePost(post.language, post.live);
  return post;
}

/** Super Admin: put a taken-down post back on the website (the last approved version). */
export async function restoreLive(id: string, viewer: StudioViewer) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can do this.", 403);
  const post = await BlogPost.findById(id);
  if (!post || post.status !== "archived" || !post.live) throw new WorkflowError("This post can't be restored.");
  if (!(await isSlugFree(post.language, post.live.slug, post._id))) {
    throw new WorkflowError("Another post now uses this web address. Change it, then publish again.", 409);
  }
  post.status = "published";
  post.editVersion += 1;
  // The working copy becomes the live version again.
  Object.assign(post, contentSnapshotFromLive(post.live));
  await post.save();
  await revalidatePost(post.language, post.live);
  return post;
}

function contentSnapshotFromLive(l: IBlogLive): Partial<IBlogContent> {
  return {
    title: l.title,
    slug: l.slug,
    excerpt: l.excerpt,
    contentHtml: l.contentHtml,
    coverImage: l.coverImage,
    categoryId: l.categoryId,
    tags: l.tags,
    seo: l.seo,
    faqs: l.faqs,
    design: l.design,
  };
}

/** Throw away unpublished edits — the working copy goes back to the live version. */
export async function discardChanges(id: string) {
  const post = await BlogPost.findById(id);
  if (!post?.live) throw new WorkflowError("There is no live version to go back to.");
  if (post.status === "archived") throw new WorkflowError("This post was taken down.");
  Object.assign(post, contentSnapshotFromLive(post.live));
  post.status = liveState(post) === "scheduled" ? "scheduled" : "published";
  post.reviewNote = undefined;
  post.editVersion += 1;
  await post.save();
  return post;
}

/** Copy an older version into the working copy (never straight to the website). */
export async function restoreRevision(id: string, revisionId: string, viewer: StudioViewer) {
  const post = await BlogPost.findById(id);
  if (!post) throw new WorkflowError("Post not found", 404);
  if (!canEdit(post, viewer)) throw new WorkflowError("Withdraw the post from review first.", 409);
  if (!mongoose.Types.ObjectId.isValid(revisionId)) throw new WorkflowError("Version not found", 404);
  const rev = await BlogRevision.findOne({ _id: revisionId, postId: post._id }).lean<any>();
  if (!rev) throw new WorkflowError("Version not found", 404);
  const s = rev.snapshot || {};
  const fields = await cleanEditorInput(s, post.language);
  // An old slug may since have been taken by another post.
  if (fields.slug && !(await isSlugFree(post.language, fields.slug, post._id))) delete fields.slug;
  Object.assign(post, fields);
  if (post.status === "published" || post.status === "scheduled") post.status = "draft";
  post.editVersion += 1;
  await post.save();
  await saveRevision(post, "restored", viewer.userId);
  return post;
}

/** Inngest cron: flip due scheduled posts to published and rebuild their pages. */
export async function publishDueScheduled(): Promise<number> {
  const now = new Date();
  // Every still-"scheduled" post whose time has come (however late this run
  // is), plus anything that went live in the last 15 minutes (e.g. it was
  // edited after scheduling, so its status is no longer "scheduled").
  const due = await BlogPost.find({
    live: { $ne: null },
    status: { $ne: "archived" },
    "live.publishedAt": { $lte: now },
    $or: [{ status: "scheduled" }, { "live.publishedAt": { $gt: new Date(now.getTime() - 15 * 60 * 1000) } }],
  })
    .select("status language live.slug live.categoryId")
    .lean<any[]>();
  for (const p of due) {
    if (p.status === "scheduled") await BlogPost.updateOne({ _id: p._id, status: "scheduled" }, { $set: { status: "published" } });
    await revalidatePost(p.language, p.live);
  }
  return due.length;
}

export function isValidPostSlug(slug: string) {
  return isValidSlug(slug) && !RESERVED_SLUGS.has(slug);
}
