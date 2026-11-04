import dbConnect from '@/lib/mongodb';
import SeoPlan, { type ISeoPlan } from '@/models/SeoPlan';
import Business from '@/models/Business';
import type { ISeoPlanDraft, IKeywordTableRow } from '@/models/Audit';

/**
 * The SEO brain's read/write surface. Jobs read `getActiveSeoPlan`; the audit
 * pipeline calls `upsertSeoPlanFromAudit`; the post-payment intake calls
 * `mergeIntakeIntoSeoPlan`. One active document per business — every write
 * bumps the version and supersedes the previous active plan.
 */

export async function getActiveSeoPlan(businessId: string): Promise<ISeoPlan | null> {
  await dbConnect();
  return SeoPlan.findOne({ businessId, status: 'active' }).sort({ version: -1 }).lean<ISeoPlan>();
}

function splitKeywords(draft: ISeoPlanDraft | undefined, keywordTable: IKeywordTableRow[], cityAreaTerms: string[]) {
  const ranked = (keywordTable || []).slice().sort((a, b) => {
    const band = { HIGH: 0, MED: 1, LOW: 2, NICHE: 3 } as Record<string, number>;
    // Rows with unavailable demand (volumeBand null) sort last.
    return (band[a.volumeBand ?? ''] ?? 4) - (band[b.volumeBand ?? ''] ?? 4);
  });
  const all = ranked.map((k) => k.keyword);
  return {
    primaryKeywords: all.slice(0, 5),
    secondaryKeywords: all.slice(5, 14),
    cityAreaTerms,
  };
}

interface UpsertInput {
  businessId: string;
  sourceAuditId?: string;
  draft?: ISeoPlanDraft;
  keywordTable: IKeywordTableRow[];
  areasChecked: string[];
  /** SEO intelligence from a full audit (absent on free reports). */
  tracking?: {
    trackedKeywords: any[];
    keywordChanges: any[];
    measurements: any[];
    serviceVisibility: any[];
    matrix: any[];
    serviceAreas: string[];
    history: any;
  };
  /** False when the audit's ranking data was unavailable: keywords are carried over, never replaced by an empty set. */
  rankingComplete?: boolean;
  baseline: {
    overallScore?: number;
    avgRank?: number;
    reviewCount?: number;
    rating?: number;
    completionPct?: number;
  };
}

/**
 * Called at the end of every completed audit (free reports included). Creates
 * version N+1 as the new active plan and supersedes the prior active one.
 * Prefills empty Business.keywords / Business.faqs from the plan, but never
 * overwrites values the owner already set.
 */
export async function upsertSeoPlanFromAudit(input: UpsertInput): Promise<ISeoPlan | null> {
  await dbConnect();
  const { businessId, sourceAuditId, draft, areasChecked, baseline, tracking } = input;
  const { trackedKeywordRows, planFocus } = await import('@/services/seo/planMemory');
  const { planChanges } = await import('@/services/seo/strategyHistory');

  const prev = await SeoPlan.findOne({ businessId }).sort({ version: -1 });
  const version = (prev?.version ?? 0) + 1;

  // An audit whose ranking failed must not overwrite a measured plan with an
  // empty or unmeasured keyword set — carry the previous one forward.
  const carryKeywords = input.rankingComplete === false && !!prev && (prev.keywordTable?.length ?? 0) > 0;
  const keywordTable: IKeywordTableRow[] = carryKeywords
    ? (prev!.keywordTable as IKeywordTableRow[])
    : [...(input.keywordTable || []), ...(tracking ? trackedKeywordRows(tracking.measurements) : [])];
  const split = splitKeywords(draft, input.keywordTable || [], areasChecked);
  const primaryKeywords = carryKeywords ? prev!.primaryKeywords : split.primaryKeywords;
  const secondaryKeywords = carryKeywords ? prev!.secondaryKeywords : split.secondaryKeywords;
  const cityAreaTerms = split.cityAreaTerms;
  const postThemes = draft?.weeklyPostThemes || [];
  const changesFromPrevious = prev
    ? planChanges(
        { version: prev.version, createdAt: String(prev.createdAt), primaryKeywords: prev.primaryKeywords || [], secondaryKeywords: prev.secondaryKeywords || [], postThemes: prev.postThemes || [], priorities: [] },
        { primaryKeywords, postThemes },
      )
    : null;

  const baselineEntry = { ...baseline, capturedAt: new Date() };
  const priorBaseline = Array.isArray(prev?.baseline) ? prev!.baseline : [];

  // Carry the owner's edits forward — an audit refresh must not wipe them.
  const carry = prev?.ownerEdited
    ? {
        suggestedTitle: prev.suggestedTitle,
        suggestedDescription: prev.suggestedDescription,
        suggestedServices: prev.suggestedServices,
        uspLine: prev.uspLine,
        reviewReplyMustInclude: prev.reviewReplyMustInclude,
      }
    : {};

  const doc = await SeoPlan.create({
    businessId,
    sourceAuditId,
    version,
    status: 'active',
    horizonDays: 30,
    activeFrom: new Date(),
    primaryKeywords,
    secondaryKeywords,
    cityAreaTerms,
    keywordTable: keywordTable || [],
    suggestedTitle: draft?.suggestedTitle,
    suggestedDescription: draft?.suggestedDescription,
    suggestedServices: draft?.suggestedServices || [],
    suggestedCategories: draft?.suggestedCategories || [],
    suggestedQas: draft?.suggestedQas || [],
    uspLine: draft?.uspLine,
    reviewReplyMustInclude: draft?.reviewReplyMustInclude || [],
    postThemes,
    keyFinding: draft?.keyFinding,
    keywordInsights: draft?.keywordInsights || [],
    marketOpportunities: draft?.marketOpportunities || [],
    competitorLandscape: draft?.competitorLandscape || [],
    actionPhases: draft?.actionPhases || [],
    draft,
    baseline: [...priorBaseline, baselineEntry].slice(-12),
    // A free report (no tracking) keeps the previous tracked set and focus.
    trackedKeywords: tracking ? tracking.trackedKeywords : prev?.trackedKeywords || [],
    keywordChanges: tracking ? tracking.keywordChanges : [],
    focus: tracking ? planFocus(tracking.serviceVisibility, tracking.matrix) : prev?.focus,
    serviceAreas: tracking ? tracking.serviceAreas : prev?.serviceAreas || [],
    history: tracking?.history ?? undefined,
    changesFromPrevious,
    dataQuality: { rankingComplete: input.rankingComplete !== false, ...(carryKeywords ? { note: 'Ranking was unavailable in the source audit — the previous measured keywords were kept.' } : {}) },
    ownerEdited: prev?.ownerEdited || false,
    ...carry,
  });

  if (prev && String(prev._id) !== String(doc._id)) {
    await SeoPlan.updateOne(
      { _id: prev._id },
      { $set: { status: 'superseded', activeUntil: new Date() } },
    );
  }

  // Prefill Business fields only when empty — never clobber owner input.
  try {
    const biz = await Business.findById(businessId).select('keywords faqs').lean<{ keywords?: string[]; faqs?: any[] }>();
    const set: Record<string, unknown> = {};
    if (biz && (!biz.keywords || biz.keywords.length === 0) && primaryKeywords.length) {
      set.keywords = [...primaryKeywords, ...cityAreaTerms].slice(0, 15);
    }
    if (biz && (!biz.faqs || biz.faqs.length === 0) && (draft?.suggestedQas?.length)) {
      set.faqs = draft.suggestedQas.slice(0, 6).map((qa) => ({ question: qa.q, answer: qa.a }));
    }
    if (Object.keys(set).length) await Business.updateOne({ _id: businessId }, { $set: set });
  } catch (err: any) {
    console.warn('[seoPlanService] business prefill skipped:', err?.message);
  }

  return doc;
}

interface IntakeMerge {
  category?: string;
  description?: string;
  services?: string;
  keywords?: string[];
  uniqueSellingPoints?: string;
  targetAudience?: string;
  competitorNames?: string[];
  primaryGoal?: string;
}

/**
 * Merge owner intake into a NEW plan version without requiring a full audit.
 * The owner's words win: their keywords lead the primary list, their USP
 * becomes uspLine, their services seed the suggested list. Marks ownerEdited
 * so future audit refreshes preserve these.
 */
export async function mergeIntakeIntoSeoPlan(businessId: string, intake: IntakeMerge): Promise<ISeoPlan | null> {
  await dbConnect();
  const prev = await SeoPlan.findOne({ businessId }).sort({ version: -1 });

  const ownerKeywords = (intake.keywords || []).map((k) => k.trim()).filter(Boolean);
  const ownerServices = (intake.services || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const version = (prev?.version ?? 0) + 1;
  const mergedPrimary = Array.from(
    new Set([...ownerKeywords, ...(prev?.primaryKeywords || [])]),
  ).slice(0, 8);

  const doc = await SeoPlan.create({
    businessId,
    sourceAuditId: prev?.sourceAuditId,
    version,
    status: 'active',
    horizonDays: prev?.horizonDays ?? 30,
    activeFrom: new Date(),
    primaryKeywords: mergedPrimary,
    secondaryKeywords: prev?.secondaryKeywords || [],
    cityAreaTerms: prev?.cityAreaTerms || [],
    keywordTable: prev?.keywordTable || [],
    suggestedTitle: prev?.suggestedTitle,
    suggestedDescription: intake.description || prev?.suggestedDescription,
    suggestedServices: Array.from(new Set([...ownerServices, ...(prev?.suggestedServices || [])])).slice(0, 15),
    suggestedCategories: prev?.suggestedCategories || [],
    suggestedQas: prev?.suggestedQas || [],
    uspLine: intake.uniqueSellingPoints || prev?.uspLine,
    reviewReplyMustInclude: prev?.reviewReplyMustInclude || [],
    postThemes: prev?.postThemes || [],
    keyFinding: prev?.keyFinding,
    keywordInsights: prev?.keywordInsights || [],
    marketOpportunities: prev?.marketOpportunities || [],
    competitorLandscape: prev?.competitorLandscape || [],
    actionPhases: prev?.actionPhases || [],
    draft: prev?.draft,
    baseline: Array.isArray(prev?.baseline) ? prev!.baseline : [],
    trackedKeywords: prev?.trackedKeywords || [],
    focus: prev?.focus,
    serviceAreas: prev?.serviceAreas || [],
    ownerEdited: true,
  });

  if (prev) {
    await SeoPlan.updateOne(
      { _id: prev._id },
      { $set: { status: 'superseded', activeUntil: new Date() } },
    );
  }
  return doc;
}

/**
 * Keywords a content job should target: the active plan's primary + city/area
 * terms, else the Business's own keyword list. One primary keyword per post
 * is enforced by the caller.
 */
export async function resolveContentKeywords(business: any): Promise<{
  keywords: string[];
  uspLine?: string;
  postThemes: Array<{ weekday: string; theme: string; keyword: string; postType: string }>;
}> {
  const plan = business?._id ? await getActiveSeoPlan(String(business._id)) : null;
  if (plan && plan.primaryKeywords?.length) {
    return {
      keywords: Array.from(new Set([...plan.primaryKeywords, ...(plan.cityAreaTerms || [])])).slice(0, 12),
      uspLine: plan.uspLine,
      postThemes: plan.postThemes || [],
    };
  }
  return {
    keywords: (business?.keywords && business.keywords.length ? business.keywords : ['services']).slice(0, 12),
    uspLine: undefined,
    postThemes: [],
  };
}
