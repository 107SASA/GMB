import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireStudioApi } from "@/lib/studioAuth";
import SitePageContent from "@/models/SitePageContent";
import { CMS_PAGES } from "@/lib/cms/pages";
import { studioError } from "@/lib/studio/api";

export const dynamic = "force-dynamic";

/** Every editable website page with its current state. */
export async function GET() {
  const auth = await requireStudioApi("cms");
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const docs = await SitePageContent.find().select("pageKey status live liveUpdatedAt updatedAt reviewNote").lean<any[]>();
    const byKey = new Map(docs.map((d) => [d.pageKey, d]));
    return NextResponse.json({
      success: true,
      data: CMS_PAGES.map((p) => {
        const d = byKey.get(p.key);
        return {
          key: p.key,
          label: p.label,
          help: p.help,
          path: p.path,
          group: p.group,
          hasFaqs: Boolean(p.faqs),
          status: d?.status || "default",
          customized: Boolean(d?.live),
          hidden: Boolean(d?.live?.noindex),
          liveUpdatedAt: d?.liveUpdatedAt || null,
          updatedAt: d?.updatedAt || null,
          reviewNote: d?.reviewNote || null,
        };
      }),
    });
  } catch (err) {
    return studioError(err, "list pages");
  }
}
