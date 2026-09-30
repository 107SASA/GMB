import {
  ACTIONABILITY_LABEL, LEGACY_REPORT_NOTICE, SEVERITY_LABEL, competitorTierLabel, completionBreakdown, completionSentence,
  isLegacyAudit, rankLabel, rankingStatRows, reviewDisplay, suspensionDisplay, toRankValue, type RankValue,
} from './reportDisplay';
import { resolveSuspensionRisk } from './reportMath';
import { contentActivityLines } from '@/services/lifecycle/monthly';

/**
 * The report as the mobile app shows it — computed on the server from the
 * same stored facts and the same display helpers as the web report
 * (FreeReportView / AuditReportGrexa / PDF), so the phone can never show a
 * different number. Strings are final display text; nothing is estimated here.
 * Returned alongside the raw audit by GET /api/audit/[id] (additive).
 */
export interface MobileReportView {
  version: 1;
  legacy: boolean;
  legacyNotice: string | null;
  aiUnavailable: boolean;
  headline: {
    issuesCount: number;
    rating: string | null;
    reviewCount: string | null;
    averageRank: string;
    rankingStatus: 'ok' | 'unavailable' | 'not_measured' | 'none';
    competitorsAhead: number;
    searchesChecked: number;
  };
  rankingStats: Array<{ label: string; value: string }>;
  keywords: Array<{ keyword: string; kind: string; rank: string; demand: string }>;
  competitors: Array<{ name: string; rating: string; reviews: string; aboveYou: string; tier: string }>;
  reviews: ReturnType<typeof reviewDisplay>;
  completion: { sentence: string; percent: number | null; missing: string[]; notChecked: string[] };
  issues: Array<{ title: string; evidence: string; severity: string; actionability: string; recommendedAction: string; growwmaticsCan: boolean }>;
  suspension: { level: string; note: string };
  monthly: null | {
    period: { start: string; end: string };
    changes: string[];
    growwmatics: string[];
    owner: string[];
    performance: string[];
    performanceNote: string;
    reviews: string[];
    contentActivity: string[];
    profileHealth: string;
    planCompleted: string[];
    planPending: string[];
    remainingIssues: string[];
  };
}

const kwValue = (k: any): RankValue =>
  k.status === 'unavailable' ? { state: 'unavailable', rank: null }
    : k.averageObservedRank != null ? { state: 'found', rank: k.averageObservedRank } : { state: 'not_found', rank: null };

export function buildMobileReportView(audit: { auditData?: any }): MobileReportView {
  const d = audit.auditData || {};
  const facts = d.facts;
  const legacy = isLegacyAudit(d);
  const reviews = d.reviewAnalysis || {};
  const checklist: Array<{ field: string; status: string }> = d.profileCompletion?.checklist || [];

  const overall = facts?.ranking?.overall;
  const rankingStatus: MobileReportView['headline']['rankingStatus'] = facts
    ? facts.ranking?.notRunReason ? 'not_measured'
      : overall && (overall.status === 'ok' || overall.status === 'partial') ? 'ok' : overall?.status === 'unavailable' ? 'unavailable' : 'none'
    : d.googleSearchRank?.averageRank > 0 ? 'ok' : 'none';
  const headlineRank: RankValue = facts
    ? overall?.averageObservedRank != null ? { state: 'found', rank: overall.averageObservedRank } : { state: rankingStatus === 'ok' ? 'not_found' : 'unavailable', rank: null }
    : toRankValue(d.googleSearchRank?.averageRank);
  const localCompetitors: any[] = d.localPackCompetitors || [];
  const competitorsAhead = facts ? (rankingStatus === 'ok' ? facts.competitorsAhead?.count ?? 0 : 0) : localCompetitors.length;
  const searchesChecked: number = facts?.competitorsAhead?.searchesChecked ?? 0;
  const competitorFacts: any[] = Array.isArray(d.competitors) ? d.competitors : [];

  const issues = Array.isArray(d.findings)
    ? d.findings.filter((f: any) => f.category !== 'data_quality' && !f.verificationOnly)
    : [];
  const legacyIssues = !Array.isArray(d.findings) ? checklist.filter((c) => c.status === 'Missing').map((c) => `${c.field} is missing on the listing`) : [];

  const lifetimeCount = typeof reviews.reviewCount === 'number' ? reviews.reviewCount : null;
  const lifetimeRating = typeof reviews.averageRating === 'number' && reviews.averageRating > 0 ? reviews.averageRating : null;
  const completion = completionBreakdown(checklist);

  const byKeyword: any[] = facts?.ranking?.byKeyword || [];
  const demand = new Map<string, string>((d.keywordTable || []).map((r: any) => [
    String(r.keyword).toLowerCase(),
    r.demandStatus === 'measured' && r.searchVolume != null ? `${r.searchVolume}/month` : 'Demand unavailable',
  ]));
  const keywords = facts
    ? byKeyword.map((k) => ({ keyword: k.keyword, kind: k.kind, rank: rankLabel(kwValue(k)), demand: demand.get(String(k.keyword).toLowerCase()) ?? '—' }))
    : (d.googleSearchRank?.topKeywords || []).map((k: any) => ({ keyword: k.keyword, kind: 'legacy', rank: rankLabel(toRankValue(k.rank ?? k.avgRank)), demand: '—' }));

  const suspension = resolveSuspensionRisk(d, completion.pct ?? 0, lifetimeCount ?? 0);
  const m = d.monthly;
  const monthly: MobileReportView['monthly'] = m ? {
    period: m.period,
    changes: (m.changes || []).map((c: any) => `${c.what}: ${c.previous} → ${c.current} (${c.actor === 'Unknown' ? 'not recorded' : c.actor === 'Owner' ? 'you' : 'GrowwMatics'})`),
    growwmatics: (m.growwmaticsOptimized || []).map((x: any) => `${x.count} ${x.what}`),
    owner: (m.ownerOptimized || []).map((x: any) => `${x.count} ${x.what}`),
    performance: m.performance?.status === 'unavailable' ? [] : (m.performance?.rows || []).map((x: any) => `${x.metric}: ${x.previous ?? 'not measured'} → ${x.current ?? 'not measured'}${x.pctChange != null ? ` (${x.pctChange > 0 ? '+' : ''}${x.pctChange}%)` : ''}`),
    performanceNote: m.performance?.status === 'unavailable' ? 'Google performance data unavailable for this period.' : 'Engagement measured by Google — not revenue.',
    reviews: [
      `New Google reviews: ${m.reviews?.newReviews ?? 0}`,
      `Rating: ${m.reviews?.ratingBefore ?? 'unknown'}★ → ${m.reviews?.ratingAfter ?? 'unknown'}★`,
      `New reviews without a reply: ${m.reviews?.unanswered ?? 0}`,
      `Review requests sent: ${m.reviews?.reviewRequestsSent ?? 0}`,
    ],
    contentActivity: contentActivityLines(m.contentActivity),
    profileHealth: m.profileHealth?.completionPercentage != null ? `${m.profileHealth.completionPercentage}% of checked fields complete` : 'Profile completion not measured',
    planCompleted: (m.planCompleted || []).map((a: any) => `${a.action} — ${a.status}`),
    planPending: (m.planPending || []).map((a: any) => `${a.action} — ${a.status}${a.statusReason ? ` (${a.statusReason})` : ''}`),
    remainingIssues: m.remainingIssues || [],
  } : null;

  return {
    version: 1,
    legacy,
    legacyNotice: legacy ? LEGACY_REPORT_NOTICE : null,
    aiUnavailable: d.aiStatus?.analysis === 'failed',
    headline: {
      issuesCount: issues.length || legacyIssues.length,
      rating: lifetimeRating != null ? lifetimeRating.toFixed(1) : null,
      reviewCount: lifetimeCount != null ? String(lifetimeCount) : null,
      averageRank: rankLabel(headlineRank),
      rankingStatus,
      competitorsAhead,
      searchesChecked,
    },
    rankingStats: facts ? rankingStatRows(overall) : [],
    keywords,
    competitors: localCompetitors.slice(0, 10).map((c: any) => {
      const cf = competitorFacts.find((x: any) => x.name === c.name);
      return {
        name: c.name,
        rating: c.rating != null ? `★ ${Number(c.rating).toFixed(1)}` : 'Unknown',
        reviews: c.reviewCount != null ? String(c.reviewCount) : 'Unknown',
        aboveYou: facts ? (cf ? `${cf.searchesAhead} of ${searchesChecked} searches` : '—') : rankLabel(toRankValue(c.avgRank)),
        tier: cf ? competitorTierLabel(cf, searchesChecked) : '',
      };
    }),
    reviews: reviewDisplay(facts?.reviews, reviews.reviewThemes === 'from-review-text' ? { praises: reviews.mostCommonPraises, complaints: reviews.mostCommonComplaints } : 'unknown'),
    completion: {
      sentence: completionSentence(completion),
      percent: completion.pct,
      missing: checklist.filter((c) => c.status === 'Missing').map((c) => c.field),
      notChecked: checklist.filter((c) => c.status === 'Unknown').map((c) => c.field),
    },
    issues: issues.length
      ? issues.map((f: any) => ({
          title: String(f.title),
          evidence: String(f.evidence || ''),
          severity: SEVERITY_LABEL[f.severity] ?? '',
          actionability: ACTIONABILITY_LABEL[f.actionability] ?? '',
          recommendedAction: String(f.recommendedAction || ''),
          growwmaticsCan: !!f.growwmaticsCapability,
        }))
      : legacyIssues.map((t) => ({ title: t, evidence: '', severity: '', actionability: '', recommendedAction: '', growwmaticsCan: false })),
    suspension: suspension.basis === 'heuristic' ? suspensionDisplay(suspension) : suspensionDisplay(null),
    monthly,
  };
}
