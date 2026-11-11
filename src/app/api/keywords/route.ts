import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import SeoPlan from '@/models/SeoPlan';
import GBPKeyword from '@/models/GBPKeyword';
import { getActiveSeoPlan } from '@/services/seoPlan/seoPlanService';
import { buildKeywordsView, volumeView } from '@/services/seo/keywordView';
import { cachedSearchVolumes } from '@/services/audit/keywordVolumeClient';

export const dynamic = 'force-dynamic';

/**
 * The SEO Plan page's Keywords tab (docs/KEYWORD_SYSTEM_PLAN.md §9) — same
 * module as the SEO Plan page itself (content_studio): the owner's
 * keywords, this month's targets, competitors per keyword, competitor gaps
 * and real Google Business Profile searches. Read-only from the active SEO
 * plan — no provider call is made here.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'content_studio', ctx.businessId);
  if (!gate.ok) return gate.response;

  await dbConnect();
  const plan: any = await getActiveSeoPlan(String(ctx.businessId));
  const b: any = ctx.business;
  const view = buildKeywordsView({
    keywordSet: plan?.keywordSet,
    gaps: plan?.competitorGaps,
    ownerKeywords: Array.isArray(b?.keywords) ? b.keywords : [],
  });

  // Owner keywords added since the last report: the number Settings / onboarding
  // already looked up (45-day cache, free) — so every page shows the same figure.
  const pending = view.yours.filter((r) => r.role === 'pending');
  if (pending.length) {
    const cached = await cachedSearchVolumes(pending.map((r) => r.keyword), { countryHint: b?.country || '' });
    for (const r of pending) {
      const k = r.keyword.trim().toLowerCase();
      if (!cached.has(k)) continue;
      const v = volumeView({ country: cached.get(k) ?? null, city: null, area: null, status: 'measured', measuredAt: null });
      Object.assign(r, { volumeText: v.text, volumeNote: v.note, volume: v.value });
    }
  }

  const latest: any = await GBPKeyword.findOne({ businessId: ctx.businessId }).sort({ year: -1, month: -1 }).select('year month').lean();
  const searchTerms = latest
    ? ((await GBPKeyword.find({ businessId: ctx.businessId, year: latest.year, month: latest.month, impressions: { $gt: 0 } })
        .sort({ impressions: -1 }).limit(20).select('keyword impressions').lean()) as any[])
        .map((t) => ({ keyword: String(t.keyword), impressions: Number(t.impressions) }))
    : [];

  return NextResponse.json({
    success: true,
    ...view,
    searchTerms,
    searchTermsMonth: latest ? `${latest.year}-${String(latest.month).padStart(2, '0')}` : null,
    research: plan?.keywordResearch ?? null,
    planVersion: plan?.version ?? null,
    googleConnected: !!b?.googleConnected,
  });
}

const pinSchema = z.object({ action: z.enum(['pin', 'unpin']), id: z.string().min(3).max(200) });

/**
 * Optional owner control: pin keeps a keyword as a focus keyword from the
 * next report on (never swapped out); unpin returns it to automatic
 * selection. Updates the active plan in place — no new version.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'content_studio', ctx.businessId);
  if (!gate.ok) return gate.response;

  const parsed = pinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 });

  await dbConnect();
  const plan: any = await getActiveSeoPlan(String(ctx.businessId));
  if (!plan || !Array.isArray(plan.keywordSet) || !plan.keywordSet.some((k: any) => k?.id === parsed.data.id)) {
    return NextResponse.json({ success: false, error: 'Keyword not found.' }, { status: 404 });
  }
  const pinned = parsed.data.action === 'pin';
  const keywordSet = plan.keywordSet.map((k: any) => {
    if (k?.id !== parsed.data.id) return k;
    const { pinned: _was, ...rest } = k;
    return pinned ? { ...rest, pinned: true } : rest;
  });
  if (pinned && keywordSet.filter((k: any) => k?.pinned).length > 5) {
    return NextResponse.json({ success: false, error: 'You can pin up to 5 focus keywords.' }, { status: 400 });
  }
  await SeoPlan.updateOne({ _id: plan._id, businessId: ctx.businessId }, { $set: { keywordSet } });
  return NextResponse.json({ success: true, pinned });
}
