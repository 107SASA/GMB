/**
 * Single source of truth for scoring/formatting logic shared by the on-screen
 * audit report (AuditReportGrexa.tsx) and the downloaded PDF (lib/pdf/reportHtml.ts).
 * These used to be two independent copies that quietly drifted apart (different
 * suspension-risk thresholds, different rank color buckets) — import from here
 * instead of re-deriving either so the screen and the download can't disagree
 * on what a business's numbers mean.
 */

/** Old audits stored "not in the top 20" as 21 — shown as "Not found", never a
 *  stand-in rank. (New audits store null; see reportDisplay.ts.) */
export function formatRank(rank: number | null | undefined): string {
  if (rank == null || Number.isNaN(Number(rank)) || Number(rank) <= 0) return '—';
  const n = Number(rank);
  if (n > 20) return 'Not found';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export type RankBucket = 'unranked' | 'good' | 'ok' | 'bad';

/** good = top 5, ok = 6-10, bad = 11+ (including the 21 "not found" sentinel). */
export function rankBucket(rank: number | null | undefined): RankBucket {
  if (rank == null || Number(rank) <= 0) return 'unranked';
  const n = Number(rank);
  if (n <= 5) return 'good';
  if (n <= 10) return 'ok';
  return 'bad';
}

export interface SuspensionRisk {
  level: 'Low' | 'Medium' | 'High';
  pct: number;
}

/** @deprecated Legacy rule for audits created before Sep 2026 — use
 *  resolveSuspensionRisk. `pct` is kept for type compatibility only and must
 *  not be displayed (it was never a measured probability). */
export function computeSuspensionRisk(completionPct: number, reviewCount: number): SuspensionRisk {
  if (completionPct >= 70 && reviewCount >= 10) return { level: 'Low', pct: 0 };
  if (completionPct >= 40) return { level: 'Medium', pct: 45 };
  return { level: 'High', pct: 85 };
}

/**
 * Suspension risk for display. New audits carry a heuristic category with
 * the reasons behind it (facts.ts suspensionRiskHeuristic). Audits created
 * before Sep 2026 fall back to the old completion/review rule — but no
 * surface shows a percentage any more: there is no measured probability.
 */
export interface DisplaySuspensionRisk {
  level: 'Low' | 'Medium' | 'High';
  reasons: string[];
  basis: 'heuristic' | 'legacy';
}

export function resolveSuspensionRisk(data: any, completionPct: number, reviewCount: number): DisplaySuspensionRisk {
  const f = data?.facts?.suspensionRisk;
  if (f?.level) return { level: f.level, reasons: Array.isArray(f.reasons) ? f.reasons : [], basis: 'heuristic' };
  return { level: computeSuspensionRisk(completionPct, reviewCount).level, reasons: [], basis: 'legacy' };
}

/**
 * Headline ranking for display. New audits: average over FOUND searches only,
 * visibility separately, and "Unavailable" when the provider failed. Old
 * audits: the legacy geo-grid average (which still mixes in the 21 sentinel).
 */
export interface RankHeadline {
  /** 'not_measured' = no search was possible (e.g. business category unknown). */
  status: 'ok' | 'unavailable' | 'not_measured' | 'none';
  display: string;
  /** Average observed position (found searches only); null when never found. */
  value: number | null;
  visibilityPct: number | null;
  testedCount: number;
  foundCount: number;
}

export function resolveRankHeadline(data: any): RankHeadline {
  const o = data?.facts?.ranking?.overall;
  if (o) {
    if (data.facts.ranking.notRunReason || o.status === 'not_run') {
      return { status: 'not_measured', display: 'Not measured', value: null, visibilityPct: null, testedCount: 0, foundCount: 0 };
    }
    if (o.status === 'unavailable' || !o.testedCount) {
      return { status: 'unavailable', display: 'Unavailable', value: null, visibilityPct: null, testedCount: 0, foundCount: 0 };
    }
    return {
      status: 'ok',
      display: o.averageObservedRank != null ? formatRank(o.averageObservedRank) : 'Not found',
      value: o.averageObservedRank ?? null,
      visibilityPct: o.visibilityRate != null ? Math.round(o.visibilityRate * 100) : null,
      testedCount: o.testedCount,
      foundCount: o.foundCount,
    };
  }
  const legacy = data?.geoGridRank?.overallAvgRank ?? data?.googleSearchRank?.averageRank ?? 0;
  if (!legacy || legacy <= 0) {
    return { status: 'none', display: '—', value: null, visibilityPct: null, testedCount: 0, foundCount: 0 };
  }
  return {
    status: 'ok',
    display: formatRank(legacy),
    value: legacy,
    visibilityPct: typeof data?.geoGridRank?.visibilityPct === 'number' ? data.geoGridRank.visibilityPct : null,
    testedCount: 0,
    foundCount: 0,
  };
}

/**
 * Rank + review values for lead-facing WhatsApp templates ({{rank}},
 * {{review}}). Both agents used to read `googleSearchRank.rank` (a field that
 * never existed → every lead was told "beyond 20" or "0") and
 * `profileScore.reviewScore` (never computed → "0%" for everyone).
 */
export function leadMessageScores(auditData: any): { rank: string; review: string } {
  const d = auditData ?? {};
  const headline = resolveRankHeadline(d);
  const rank = headline.status === 'ok'
    ? (headline.value != null && headline.value <= 20 ? String(Math.round(headline.value)) : 'beyond 20')
    : 'not measured yet';

  // Review score: the computed review-quality score when reviews were
  // actually synced; otherwise the real Google rating as a share of 5★;
  // otherwise unknown. Never a placeholder 0.
  const quality = d.facts?.reviews?.recent?.status === 'verified' ? d.reviewQualityScore : undefined;
  const rating = d.facts?.reviews?.lifetime?.rating ?? d.reviewAnalysis?.averageRating;
  const review = typeof quality === 'number'
    ? String(Math.round(quality))
    : typeof rating === 'number' && rating > 0
      ? String(Math.round((rating / 5) * 100))
      : 'n/a';
  return { rank, review };
}

/**
 * Human-readable facts for WhatsApp messages — the SAME validated values the
 * report shows (never a separate formula). Unknown values read as "not
 * measured", never 0.
 */
export interface LeadMessageFacts {
  rankText: string;
  profileText: string;
  seoText: string;
  reviewText: string;
  /** Up to 3 verified issue titles, most important first. */
  issues: string[];
  /** Pre-formatted numbered list (or '' when nothing was verified). */
  issuesBlock: string;
}

export function leadMessageFacts(auditData: any): LeadMessageFacts {
  const d = auditData ?? {};
  const headline = resolveRankHeadline(d);
  const rankText = headline.status !== 'ok'
    ? 'not measured yet'
    : headline.value != null && headline.value <= 20
      ? `#${Number.isInteger(headline.value) ? headline.value : headline.value.toFixed(1)}${d.facts ? ` (average where you appeared, ${headline.foundCount} of ${headline.testedCount} searches)` : ''}`
      : 'not found in the top 20';
  const pc = d.profileCompletion;
  const known = (pc?.checklist ?? []).filter((c: any) => c.status !== 'Unknown').length;
  const profileText = typeof pc?.completionPercentage === 'number' && known > 0
    ? `${pc.completionPercentage}% of the ${known} fields we could check`
    : 'not measured';
  const seoText = typeof d.seoScore?.score === 'number' ? `${d.seoScore.score}%` : 'not measured';
  const lifetime = d.facts?.reviews?.lifetime;
  const reviewText = lifetime
    ? lifetime.status === 'verified' && lifetime.totalCount != null
      ? `${lifetime.rating != null ? `${lifetime.rating}★ from ` : ''}${lifetime.totalCount} Google review${lifetime.totalCount === 1 ? '' : 's'}`
      : 'not measured'
    : typeof d.reviewAnalysis?.reviewCount === 'number' && d.reviewAnalysis.reviewCount > 0
      ? `${d.reviewAnalysis.averageRating ? `${d.reviewAnalysis.averageRating}★ from ` : ''}${d.reviewAnalysis.reviewCount} reviews`
      : 'not measured';
  const ordered: string[] = Array.isArray(d.priorityFixes) && d.priorityFixes.length && d.facts
    ? d.priorityFixes.map((f: any) => String(f.title))
    : Array.isArray(d.findings)
      ? d.findings.filter((f: any) => f.category !== 'data_quality' && !f.verificationOnly).map((f: any) => String(f.title))
      : [];
  const issues = ordered.slice(0, 3);
  const issuesBlock = issues.length
    ? `What we found:\n${issues.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';
  return { rankText, profileText, seoText, reviewText, issues, issuesBlock };
}
