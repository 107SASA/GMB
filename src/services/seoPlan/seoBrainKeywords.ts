import dbConnect from '@/lib/mongodb';
import { brandWords } from '@/services/content/keywordPriority';

/**
 * Keywords the business's own research already produced — the "SEO brain"
 * (active SeoPlan, else the latest completed report) — for pre-filling the
 * onboarding intake and its "Suggest keywords" button. Stored data only: no
 * crawl, no ranking check, no AI call.
 *
 *   measured — the report actually checked this search on Google Maps
 *   proposed — the SEO plan suggested it from verified services / area (never measured)
 *
 * Brand-name searches (the business's own name) are excluded: they are not
 * target keywords.
 */
export interface BrainKeyword {
  keyword: string;
  source: 'measured' | 'proposed';
  /** Observed Google Maps position when measured and found. */
  rank?: number | null;
}

export async function seoBrainKeywords(business: { _id: any; name?: string; category?: string; userDefinedCategory?: string }): Promise<BrainKeyword[]> {
  await dbConnect();
  const [{ getActiveSeoPlan }, { default: Audit }] = await Promise.all([
    import('@/services/seoPlan/seoPlanService'),
    import('@/models/Audit'),
  ]);
  const plan: any = await getActiveSeoPlan(String(business._id)).catch(() => null);
  let table: any[] = plan?.keywordTable || [];
  let proposed: any[] = plan?.draft?.proposedKeywords || [];
  if (!table.length && !proposed.length) {
    const audit: any = await Audit.findOne({ businessId: business._id, status: 'COMPLETED' })
      .sort({ createdAt: -1 })
      .select('auditData.keywordTable auditData.seoPlanDraft.proposedKeywords')
      .lean();
    table = audit?.auditData?.keywordTable || [];
    proposed = audit?.auditData?.seoPlanDraft?.proposedKeywords || [];
  }

  const brand = brandWords(business.name || '', [business.userDefinedCategory || '', business.category || ''].filter(Boolean));
  const isBrand = (k: string) => {
    const words = k.toLowerCase().split(/\s+/);
    return brand.some((b) => words.includes(b));
  };
  const seen = new Set<string>();
  const out: BrainKeyword[] = [];
  const add = (keyword: unknown, source: BrainKeyword['source'], rank?: number | null) => {
    const k = String(keyword || '').trim();
    const key = k.toLowerCase();
    if (!k || !/[a-z]/i.test(k) || seen.has(key) || isBrand(k)) return;
    seen.add(key);
    out.push({ keyword: k, source, ...(rank !== undefined ? { rank } : {}) });
  };
  for (const r of table) {
    if ((r.rankStatus ?? 'ok') !== 'ok') continue;
    const rank = typeof r.rank === 'number' && r.rank >= 1 && r.rank <= 20 ? r.rank : typeof r.mapsRank === 'number' && r.mapsRank >= 1 && r.mapsRank <= 20 ? r.mapsRank : null;
    add(r.keyword, 'measured', rank);
  }
  for (const p of proposed) add(typeof p === 'string' ? p : p?.keyword, 'proposed');
  return out;
}
