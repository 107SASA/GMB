import { revalidatePath } from "next/cache";
import mongoose from "mongoose";
import SitePageContent, { type ISitePageFields } from "@/models/SitePageContent";
import { getCmsPage, type CmsPageDef } from "@/lib/cms/pages";
import { cleanText, cleanImageUrl } from "@/lib/blog/sanitize";
import { WorkflowError } from "@/lib/blog/workflow";
import type { StudioViewer } from "@/lib/studioAuth";

/**
 * Website pages (Content Studio → Website pages) — same rules as blog posts:
 * team members save a draft and submit it; a Super Admin approves, which is
 * the only thing that writes `live` and rebuilds the page.
 */

export function requirePage(key: string): CmsPageDef {
  const page = getCmsPage(key);
  if (!page) throw new WorkflowError("Page not found", 404);
  return page;
}

export function cleanPageFields(body: any, page: CmsPageDef): ISitePageFields {
  const out: ISitePageFields = {
    seoTitle: cleanText(body?.seoTitle, 120),
    seoDescription: cleanText(body?.seoDescription, 320),
    ogTitle: cleanText(body?.ogTitle, 120),
    ogDescription: cleanText(body?.ogDescription, 320),
    ogImageUrl: cleanImageUrl(body?.ogImageUrl),
    noindex: Boolean(body?.noindex),
  };
  if (page.faqs) {
    const list = (Array.isArray(body?.faqs) ? body.faqs : [])
      .map((f: any) => ({ question: cleanText(f?.question, 300), answer: cleanText(f?.answer, 2000) }))
      .filter((f: { question: string; answer: string }) => f.question && f.answer)
      .slice(0, 30);
    out.faqs = list;
  }
  return out;
}

function revalidatePage(page: CmsPageDef) {
  try {
    for (const p of [page.path, ...(page.alsoRevalidate || []), "/sitemap.xml"]) revalidatePath(p);
  } catch (err: any) {
    console.error("[cms] revalidate failed:", err?.message);
  }
}

export async function getPageDoc(key: string) {
  return SitePageContent.findOne({ pageKey: key });
}

/** Save the draft. A Super Admin may publish in the same step. */
export async function savePageDraft(key: string, body: any, viewer: StudioViewer) {
  const page = requirePage(key);
  const existing = await getPageDoc(key);
  if (existing?.status === "in_review" && !viewer.isSuperAdmin) {
    throw new WorkflowError("This page is waiting for approval. Click “Withdraw” to edit it again.", 409);
  }
  const draft = cleanPageFields(body, page);
  const doc = await SitePageContent.findOneAndUpdate(
    { pageKey: key },
    {
      $set: {
        draft,
        updatedBy: viewer.userId,
        status: existing?.status === "changes_requested" ? "changes_requested" : "draft",
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc!;
}

export async function submitPage(key: string, viewer: StudioViewer) {
  const page = requirePage(key);
  const doc = await getPageDoc(key);
  if (!doc) throw new WorkflowError("Save your changes first.");
  if (doc.status === "in_review") throw new WorkflowError("Already waiting for approval.");
  doc.status = "in_review";
  doc.submittedAt = new Date();
  doc.submittedBy = new mongoose.Types.ObjectId(viewer.userId);
  doc.reviewNote = undefined;
  await doc.save();
  return { doc, page };
}

export async function withdrawPage(key: string) {
  const doc = await SitePageContent.findOneAndUpdate({ pageKey: key, status: "in_review" }, { $set: { status: "draft" } }, { new: true });
  if (!doc) throw new WorkflowError("This page is not waiting for approval.");
  return doc;
}

export async function approvePage(key: string, viewer: StudioViewer) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can publish.", 403);
  const page = requirePage(key);
  const doc = await getPageDoc(key);
  if (!doc) throw new WorkflowError("There are no changes to publish.");
  doc.live = cleanPageFields(doc.draft || {}, page);
  doc.status = "published";
  doc.liveUpdatedAt = new Date();
  doc.reviewedAt = new Date();
  doc.reviewedBy = new mongoose.Types.ObjectId(viewer.userId);
  doc.reviewNote = undefined;
  await doc.save();
  revalidatePage(page);
  return { doc, page };
}

export async function requestPageChanges(key: string, viewer: StudioViewer, note: string) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can do this.", 403);
  const text = cleanText(note, 2000);
  if (!text) throw new WorkflowError("Write a short note so the editor knows what to change.");
  const doc = await SitePageContent.findOneAndUpdate(
    { pageKey: key, status: { $in: ["in_review", "draft"] } },
    { $set: { status: "changes_requested", reviewNote: text, reviewedAt: new Date(), reviewedBy: viewer.userId } },
    { new: true }
  );
  if (!doc) throw new WorkflowError("This page is not waiting for approval.");
  return doc;
}

/** Super Admin: drop every change — the page goes back to its built-in text. */
export async function resetPage(key: string, viewer: StudioViewer) {
  if (!viewer.isSuperAdmin) throw new WorkflowError("Only a Super Admin can do this.", 403);
  const page = requirePage(key);
  await SitePageContent.deleteOne({ pageKey: key });
  revalidatePage(page);
}

/** Discard the draft — it goes back to what is live now. */
export async function discardPageDraft(key: string) {
  const doc = await getPageDoc(key);
  if (!doc) return null;
  if (!doc.live) {
    await SitePageContent.deleteOne({ pageKey: key });
    return null;
  }
  doc.draft = doc.live;
  doc.status = "published";
  doc.reviewNote = undefined;
  await doc.save();
  return doc;
}
