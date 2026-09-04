import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import GBPKeyword from '@/models/GBPKeyword';
import GBPKeywordIntel, { KEYWORD_INTEL_CACHE_DAYS } from '@/models/GBPKeywordIntel';
import { generateKeywordIntelligence } from '@/services/ai';

const CACHE_MS = KEYWORD_INTEL_CACHE_DAYS * 24 * 60 * 60 * 1000;

async function buildIntel(businessId: string, organizationId: string, business: Record<string, any>) {
  // Latest month of real keyword impressions for this business.
  const latestKw = (await GBPKeyword.findOne({ businessId }).sort({ year: -1, month: -1 }).lean()) as any;
  let currentKeywords: { keyword: string; impressions: number }[] = [];
  if (latestKw) {
    const rows = (await GBPKeyword.find({ businessId, year: latestKw.year, month: latestKw.month })
      .sort({ impressions: -1 })
      .limit(20)
      .lean()) as any[];
    currentKeywords = rows.map((r) => ({ keyword: r.keyword, impressions: r.impressions ?? 0 }));
  }
  // Fall back to owner-entered target keywords when there's no GBP data yet.
  if (currentKeywords.length === 0 && Array.isArray(business.keywords)) {
    currentKeywords = business.keywords.slice(0, 15).map((k: string) => ({ keyword: k, impressions: 0 }));
  }

  const result = await generateKeywordIntelligence({
    category: business.category ?? '',
    description: business.description ?? '',
    city: business.city || business.address || '',
    currentKeywords,
  });

  const totalEstimatedVolume = result.currentKeywords.reduce((a, k) => a + (k.estMonthlyVolume ?? 0), 0);

  const doc = await GBPKeywordIntel.findOneAndUpdate(
    { businessId },
    {
      businessId,
      organizationId,
      generatedAt: new Date(),
      currentKeywords: result.currentKeywords,
      growthKeywords: result.growthKeywords,
      totalEstimatedVolume,
    },
    { upsert: true, new: true }
  ).lean();

  return doc as any;
}

export async function GET(request: NextRequest) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'google_ranking_agent');
  if (!gate.ok) return gate.response;

  await dbConnect();

  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  const existing = (await GBPKeywordIntel.findOne({ businessId: ctx.businessId }).lean()) as any;

  let doc = existing;
  const stale = !existing || Date.now() - new Date(existing.generatedAt).getTime() > CACHE_MS;
  if (refresh || stale) {
    try {
      doc = await buildIntel(ctx.businessId, ctx.organizationId, ctx.business);
    } catch (e) {
      console.error('keyword-intelligence build failed', e);
      if (!existing) return NextResponse.json({ error: 'Could not generate keyword insights right now.' }, { status: 502 });
      // fall through to serve the stale copy
    }
  }

  return NextResponse.json({
    generatedAt: doc?.generatedAt ?? null,
    totalEstimatedVolume: doc?.totalEstimatedVolume ?? 0,
    currentKeywords: doc?.currentKeywords ?? [],
    growthKeywords: doc?.growthKeywords ?? [],
    stale: doc ? Date.now() - new Date(doc.generatedAt).getTime() > CACHE_MS : true,
  });
}

// Explicit regenerate (button on the Insights page).
export async function POST() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'google_ranking_agent');
  if (!gate.ok) return gate.response;

  await dbConnect();
  try {
    const doc = await buildIntel(ctx.businessId, ctx.organizationId, ctx.business);
    return NextResponse.json({
      generatedAt: doc.generatedAt,
      totalEstimatedVolume: doc.totalEstimatedVolume,
      currentKeywords: doc.currentKeywords,
      growthKeywords: doc.growthKeywords,
      stale: false,
    });
  } catch (e) {
    console.error('keyword-intelligence regenerate failed', e);
    return NextResponse.json({ error: 'Could not regenerate keyword insights right now.' }, { status: 502 });
  }
}
