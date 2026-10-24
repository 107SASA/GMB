import axios from 'axios';
import { z } from 'zod';
import { api, businessHeaders } from '../client';
import { PlanLimitError } from './reviews';

/**
 * Audit Engine — mirrors the web flow:
 *   POST /api/audit dispatches an async Inngest job and returns the id;
 *   the detail screen polls GET /api/audit/[id] every 3s while PENDING.
 * The list is tenant-scoped server-side (all businesses), same as the web.
 *
 * auditData follows IAuditData in src/models/Audit.ts (V6/V7). Old V5 audits
 * stored several sections as plain strings, so list items are normalized
 * from either shape.
 */

export const auditListItemSchema = z.object({
  _id: z.string(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).catch('PENDING'),
  overallScore: z.number().nullable().catch(null),
  businessName: z.string().catch('Unknown business'),
  createdAt: z.string().optional(),
});
export type AuditListItem = z.infer<typeof auditListItemSchema>;

/** GET /api/audit — bare array, newest first, for this business. */
export async function fetchAudits(businessId?: string): Promise<AuditListItem[]> {
  const { data } = await api.get('/api/audit', businessId ? businessHeaders(businessId) : undefined);
  if (!Array.isArray(data)) throw new Error('Unexpected audits response');
  return z
    .array(auditListItemSchema.nullable().catch(null))
    .parse(data)
    .filter((a): a is AuditListItem => a !== null);
}

// --- Audit detail: tolerant IAuditData ---------------------------------------

const numberOrNull = z.number().nullable().catch(null);
const stringOrNull = z.string().nullable().catch(null);

const stringList = z
  .array(z.string().nullable().catch(null))
  .catch([])
  .transform((items) => items.filter((s): s is string => !!s));

/** V5 stored strengths/weaknesses/fixes as strings; V6/V7 as objects. */
const richItemSchema = z
  .union([
    z.string().transform((title) => ({
      title,
      detail: null as string | null,
      impact: null as string | null,
      effort: null as string | null,
      gain: null as string | null,
    })),
    z
      .object({
        title: z.string().catch(''),
        observation: stringOrNull,
        evidence: stringOrNull,
        reason: stringOrNull,
        impact: stringOrNull,
        risk: stringOrNull,
        effort: stringOrNull,
        expectedScoreGain: stringOrNull,
      })
      .transform((item) => ({
        title: item.title,
        detail: item.observation ?? item.evidence ?? item.reason ?? null,
        impact: item.impact ?? item.risk ?? null,
        effort: item.effort,
        gain: item.expectedScoreGain,
      })),
  ])
  .nullable()
  .catch(null);

const richList = z
  .array(richItemSchema)
  .catch([])
  .transform((items) =>
    items.filter((i): i is NonNullable<typeof i> => i !== null && !!i.title)
  );
export type AuditRichItem = ReturnType<(typeof richList)['parse']>[number];

/** V5 plans were strings; V6/V7 are { week|month, tasks[], … } blocks. */
const planBlockSchema = z
  .union([
    z.string().transform((label) => ({ label, tasks: [] as string[], outcome: null as string | null })),
    z
      .object({
        week: stringOrNull,
        month: stringOrNull,
        tasks: stringList,
        expectedOutcome: stringOrNull,
        focusAreas: stringList,
      })
      .transform((block) => ({
        label: block.week ?? block.month ?? '',
        tasks: [...block.tasks, ...block.focusAreas],
        outcome: block.expectedOutcome,
      })),
  ])
  .nullable()
  .catch(null);

const planList = z
  .array(planBlockSchema)
  .catch([])
  .transform((blocks) =>
    blocks.filter(
      (b): b is NonNullable<typeof b> => b !== null && (!!b.label || b.tasks.length > 0)
    )
  );
export type AuditPlanBlock = ReturnType<(typeof planList)['parse']>[number];

const keywordRankSchema = z.object({
  keyword: z.string().catch(''),
  rank: numberOrNull,
  avgRank: numberOrNull,
});
export type AuditKeywordRank = z.infer<typeof keywordRankSchema>;

const competitorSchema = z.object({
  name: z.string().catch('Competitor'),
  category: stringOrNull,
  rating: numberOrNull,
  reviewCount: numberOrNull,
  estimatedRank: numberOrNull,
  avgRank: numberOrNull,
  distance: stringOrNull,
  reason: stringOrNull,
});
export type AuditCompetitor = z.infer<typeof competitorSchema>;

const checklistItemSchema = z.object({
  field: z.string().catch(''),
  status: z.enum(['Complete', 'Partial', 'Missing', 'Unknown']).catch('Unknown'),
});
export type AuditChecklistItem = z.infer<typeof checklistItemSchema>;

const auditDataSchema = z
  .object({
    // Legacy V5 fields (kept so old audits still render something).
    overallScore: numberOrNull,
    executiveSummary: stringOrNull,
    growthOpportunities: stringList,

    googleSearchRank: z
      .object({
        averageRank: numberOrNull,
        score: numberOrNull, // legacy
        topKeywords: z.array(keywordRankSchema.nullable().catch(null)).catch([]),
      })
      .nullable()
      .catch(null),
    geoGridRank: z
      .object({
        overallAvgRank: numberOrNull,
        keywords: z.array(keywordRankSchema.nullable().catch(null)).catch([]),
      })
      .nullable()
      .catch(null),
    profileScore: z
      .object({
        overallScore: numberOrNull,
        score: numberOrNull, // legacy
      })
      .nullable()
      .catch(null),
    seoScore: z
      .object({
        score: numberOrNull,
        missingKeywords: stringList,
        optimizationOpportunities: stringList,
      })
      .nullable()
      .catch(null),
    reviewAnalysis: z
      .object({
        score: numberOrNull, // legacy
        reviewCount: numberOrNull,
        averageRating: numberOrNull,
        reviewsPerWeek: numberOrNull,
        industryAverage: numberOrNull,
        responseRate: stringOrNull,
        positivePercent: numberOrNull,
        negativePercent: numberOrNull,
        mostCommonPraises: stringList,
        mostCommonComplaints: stringList,
      })
      .nullable()
      .catch(null),
    profileCompletion: z
      .object({
        completionPercentage: numberOrNull,
        checklist: z
          .array(checklistItemSchema.nullable().catch(null))
          .catch([])
          .transform((items) =>
            items.filter((i): i is AuditChecklistItem => i !== null && !!i.field)
          ),
      })
      .nullable()
      .catch(null),
    localPackCompetitors: z.array(competitorSchema.nullable().catch(null)).catch([]),
    competitors: z.array(competitorSchema.nullable().catch(null)).catch([]),
    strengths: richList,
    weaknesses: richList,
    quickWins: stringList,
    priorityFixes: richList,
    thirtyDayPlan: planList,
    ninetyDayPlan: planList,
  })
  .nullable()
  .catch(null);

export const auditSchema = z.object({
  _id: z.string(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).catch('PENDING'),
  businessName: z.string().catch('Unknown business'),
  location: stringOrNull,
  address: stringOrNull,
  businessId: stringOrNull,
  auditVersion: stringOrNull,
  /** Lives on the audit document, not inside auditData. */
  overallScore: numberOrNull,
  createdAt: z.string().optional(),
  auditData: auditDataSchema,
});
export type Audit = z.infer<typeof auditSchema> & { mobileView?: MobileReportView | null };

/**
 * The report exactly as the web shows it — computed server-side from the
 * verified facts (src/services/audit/mobileView.ts on the server). Present on
 * completed audits from servers with the evidence-based engine; when absent
 * the screen falls back to the legacy fields above.
 */
const lines = z.array(z.string()).catch([]);
export const mobileReportViewSchema = z.object({
  version: z.number().catch(1),
  legacy: z.boolean().catch(false),
  legacyNotice: z.string().nullable().catch(null),
  aiUnavailable: z.boolean().catch(false),
  headline: z.object({
    issuesCount: z.number().catch(0),
    rating: z.string().nullable().catch(null),
    reviewCount: z.string().nullable().catch(null),
    averageRank: z.string().catch('Not measured'),
    rankingStatus: z.string().catch('none'),
    competitorsAhead: z.number().catch(0),
    searchesChecked: z.number().catch(0),
  }),
  rankingStats: z.array(z.object({ label: z.string(), value: z.string() })).catch([]),
  keywords: z.array(z.object({ keyword: z.string(), kind: z.string().catch(''), rank: z.string(), demand: z.string().catch('—') })).catch([]),
  competitors: z.array(z.object({ name: z.string(), rating: z.string(), reviews: z.string(), aboveYou: z.string(), tier: z.string().catch('') })).catch([]),
  reviews: z.object({
    lifetimeCount: z.string(), lifetimeRating: z.string(), recentCount: z.string(), recentPeriod: z.string(),
    reviewsPerWeek: z.string(), responseRate: z.string(), themes: z.string(),
  }).nullable().catch(null),
  completion: z.object({ sentence: z.string(), percent: z.number().nullable().catch(null), missing: lines, notChecked: lines }).nullable().catch(null),
  issues: z.array(z.object({
    title: z.string(), evidence: z.string().catch(''), severity: z.string().catch(''), actionability: z.string().catch(''),
    recommendedAction: z.string().catch(''), growwmaticsCan: z.boolean().catch(false),
  })).catch([]),
  suspension: z.object({ level: z.string(), note: z.string() }).nullable().catch(null),
  monthly: z.object({
    period: z.object({ start: z.string(), end: z.string() }).nullable().catch(null),
    changes: lines, growwmatics: lines, owner: lines, performance: lines, performanceNote: z.string().catch(''),
    reviews: lines, contentActivity: lines, profileHealth: z.string().catch(''), planCompleted: lines, planPending: lines, remainingIssues: lines,
  }).nullable().catch(null),
});
export type MobileReportView = z.infer<typeof mobileReportViewSchema>;
export type AuditData = NonNullable<Audit['auditData']>;

/** GET /api/audit/[id] — wrapped `{ success, audit }`; polled while PENDING. */
export async function fetchAudit(auditId: string, businessId?: string): Promise<Audit> {
  const { data } = await api.get(`/api/audit/${auditId}`, businessId ? businessHeaders(businessId) : undefined);
  const parsed = z
    .object({ audit: auditSchema, mobileView: mobileReportViewSchema.nullable().optional().catch(null) })
    .parse(data);
  return { ...parsed.audit, mobileView: parsed.mobileView ?? null };
}

/**
 * POST /api/audit — creates a PENDING audit and dispatches the background
 * job; returns the new audit id. 403 UPGRADE_REQUIRED → PlanLimitError.
 */
export async function createAudit(input: {
  businessId: string;
  categoryOverride?: string;
  cityOverride?: string;
}): Promise<string> {
  try {
    const { data } = await api.post('/api/audit', input);
    return z.object({ auditId: z.string() }).parse(data).auditId;
  } catch (error) {
    if (axios.isAxiosError(error) && (error.response?.data as any)?.code === 'UPGRADE_REQUIRED') {
      throw new PlanLimitError("This feature isn't included in your current plan.");
    }
    throw error;
  }
}

/** POST /api/audit/[id]/share — mints a 30-day public report token. */
export async function shareAudit(auditId: string): Promise<string> {
  const { data } = await api.post(`/api/audit/${auditId}/share`);
  return z.object({ token: z.string() }).parse(data).token;
}
