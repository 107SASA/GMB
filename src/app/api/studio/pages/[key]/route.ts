import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import User from "@/models/User";
import {
  requirePage,
  getPageDoc,
  savePageDraft,
  submitPage,
  withdrawPage,
  approvePage,
  requestPageChanges,
  resetPage,
  discardPageDraft,
} from "@/lib/cms/workflow";
import { notifySubmitted, notifyReviewed } from "@/lib/studio/notify";
import { studioError, logStudioAction } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

async function state(key: string) {
  const page = requirePage(key);
  const doc: any = await getPageDoc(key).then((d) => d?.toObject() ?? null);
  const submitter = doc?.submittedBy ? await User.findById(doc.submittedBy).select("fullName").lean<any>() : null;
  return {
    page: {
      key: page.key,
      label: page.label,
      help: page.help,
      path: page.path,
      group: page.group,
      absoluteTitle: Boolean(page.absoluteTitle),
      defaults: {
        seoTitle: page.title,
        seoDescription: page.description,
        ogTitle: page.ogTitle || "",
        ogDescription: page.ogDescription || "",
        faqs: page.faqs || null,
      },
    },
    draft: doc?.draft || null,
    live: doc?.live || null,
    status: doc?.status || "default",
    reviewNote: doc?.reviewNote || null,
    submittedBy: submitter?.fullName || null,
    submittedAt: doc?.submittedAt || null,
    liveUpdatedAt: doc?.liveUpdatedAt || null,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("cms");
  if (!auth.ok) return auth.response;
  try {
    const { key } = await params;
    await dbConnect();
    return NextResponse.json({ success: true, data: { ...(await state(key)), canPublish: auth.viewer.isSuperAdmin } });
  } catch (err) {
    return studioError(err, "get page");
  }
}

/** Save the draft. Body: page fields (+ publish: true for a Super Admin to publish in one step). */
export async function PUT(req: Request, { params }: Ctx) {
  const auth = await requireStudioApi("cms");
  if (!auth.ok) return auth.response;
  try {
    const { key } = await params;
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    await savePageDraft(key, body, auth.viewer);
    if (body?.publish === true && auth.viewer.isSuperAdmin) await approvePage(key, auth.viewer);
    await logStudioAction(auth.viewer, body?.publish ? "page.save_publish" : "page.save", { pageKey: key });
    return NextResponse.json({ success: true, data: await state(key) });
  } catch (err) {
    return studioError(err, "save page");
  }
}

const SUPER_ONLY = new Set(["approve", "request_changes", "reset"]);

/** Body: { action: 'submit' | 'withdraw' | 'discard' | 'approve' | 'request_changes' | 'reset', note? } */
export async function POST(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const auth = await requireStudioApi(SUPER_ONLY.has(action) ? "super_admin" : "cms");
  if (!auth.ok) return auth.response;
  try {
    const { key } = await params;
    await dbConnect();
    const v = auth.viewer;
    const editPath = `/studio/pages/${key}`;
    switch (action) {
      case "submit": {
        const { page } = await submitPage(key, v);
        if (!v.isSuperAdmin) await notifySubmitted({ kind: "page", title: page.label, byName: v.fullName || v.email, reviewPath: editPath });
        break;
      }
      case "withdraw":
        await withdrawPage(key);
        break;
      case "discard":
        await discardPageDraft(key);
        break;
      case "approve": {
        const { doc, page } = await approvePage(key, v);
        if (doc.submittedBy && String(doc.submittedBy) !== v.userId) {
          await notifyReviewed({ submittedBy: doc.submittedBy, title: page.label, outcome: "published", editPath });
        }
        break;
      }
      case "request_changes": {
        const doc = await requestPageChanges(key, v, String(body?.note || ""));
        const page = requirePage(key);
        if (doc.submittedBy) {
          await notifyReviewed({ submittedBy: doc.submittedBy, title: page.label, outcome: "changes_requested", note: doc.reviewNote, editPath });
        }
        break;
      }
      case "reset":
        await resetPage(key, v);
        break;
      default:
        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }
    await logStudioAction(v, `page.${action}`, { pageKey: key });
    return NextResponse.json({ success: true, data: await state(key) });
  } catch (err) {
    return studioError(err, "page action");
  }
}
