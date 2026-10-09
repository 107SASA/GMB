/**
 * Audit kind, audit-to-audit comparison and the optimization plan
 * (pure — runs under `node --test`).
 *
 * The free report is a public-data snapshot. A connected audit (after Google
 * connection) is a separate, fresh Audit document; it never overwrites the
 * free report. The comparison only compares like with like and says so when
 * two audits measured different things.
 */

import { findingExecution } from './findings.ts';

export type AuditKind = 'free_report' | 'connected_baseline' | 'monthly' | 'dashboard';

export function auditKindOf(audit: { fastMode?: boolean; metadata?: { trigger?: string } | null }): AuditKind {
  if (audit.fastMode) return 'free_report';
  const t = audit.metadata?.trigger || '';
  if (t === 'audit-autopilot-first-run') return 'connected_baseline';
  if (t === 'audit-autopilot-monthly') return 'monthly';
  return 'dashboard';
}

// ── Comparison ─────────────────────────────────────────────────────────────

export interface ComparableSnapshot {
  auditId: string;
  kind: AuditKind;
  at: string;
  /** Keywords searched, for like-for-like ranking comparison. */
  keywords: string[];
  searches: number;
  foundCount: number;
  top3Count: number;
  averageObservedRank: number | null;
  reviewCount: number | null;
  rating: number | null;
  completionPercentage: number | null;
  completionScope: string | null;
  /** Which fields the percentage was measured over beyond the scope (absent = standard). */
  completionBasis?: string | null;
  /** Google Performance API totals for a fixed window (connected audits only). */
  performance?: { days: number; calls: number; websiteClicks: number; directionRequests: number } | null;
  /** FR-4 audit score. Compared only with the same score version, never with profile completion. */
  fr4Overall?: number | null;
  fr4ScoreVersion?: string | null;
}

export interface ComparisonRow {
  metric: string;
  before: string;
  after: string;
  change: 'better' | 'worse' | 'same' | 'not_comparable';
  /** Measured % change — only when both values were measured the same way and before > 0. */
  pctChange?: number | null;
  note?: string;
}

const pct = (before: number | null | undefined, after: number | null | undefined): number | null =>
  before != null && after != null && before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null;

export interface AuditComparison {
  previousAuditId: string;
  previousKind: AuditKind;
  previousAt: string;
  rows: ComparisonRow[];
}

const fmt = (v: number | null, suffix = '') => (v == null ? 'unknown' : `${v}${suffix}`);

export function compareAudits(prev: ComparableSnapshot, cur: ComparableSnapshot): AuditComparison {
  const rows: ComparisonRow[] = [];
  const same = (a: string[], b: string[]) => {
    const A = new Set(a.map((x) => x.toLowerCase()));
    return b.length > 0 && b.length === A.size && b.every((x) => A.has(x.toLowerCase()));
  };
  const rankComparable = same(prev.keywords, cur.keywords) && prev.searches === cur.searches && prev.searches > 0;
  const rankNote = rankComparable ? undefined : 'Different searches were measured, so rankings are not compared.';
  const dir = (b: number | null, a: number | null, higherIsBetter = true): ComparisonRow['change'] => {
    if (b == null || a == null) return 'not_comparable';
    if (a === b) return 'same';
    return (a > b) === higherIsBetter ? 'better' : 'worse';
  };

  rows.push({
    metric: 'Searches where you appear in the top 20',
    before: `${prev.foundCount} of ${prev.searches}`,
    after: `${cur.foundCount} of ${cur.searches}`,
    change: rankComparable ? dir(prev.foundCount, cur.foundCount) : 'not_comparable',
    note: rankNote,
  });
  rows.push({
    metric: 'Searches where you are in the top 3',
    before: `${prev.top3Count} of ${prev.searches}`,
    after: `${cur.top3Count} of ${cur.searches}`,
    change: rankComparable ? dir(prev.top3Count, cur.top3Count) : 'not_comparable',
    note: rankNote,
  });
  rows.push({
    metric: 'Average position where found',
    before: prev.averageObservedRank != null ? `#${prev.averageObservedRank}` : 'not found',
    after: cur.averageObservedRank != null ? `#${cur.averageObservedRank}` : 'not found',
    change: rankComparable ? dir(prev.averageObservedRank, cur.averageObservedRank, false) : 'not_comparable',
    note: rankNote,
  });
  rows.push({
    metric: 'Google reviews (lifetime)',
    before: fmt(prev.reviewCount),
    after: fmt(cur.reviewCount),
    change: dir(prev.reviewCount, cur.reviewCount),
    pctChange: pct(prev.reviewCount, cur.reviewCount),
  });
  rows.push({
    metric: 'Google rating',
    before: fmt(prev.rating, '★'),
    after: fmt(cur.rating, '★'),
    change: dir(prev.rating, cur.rating),
  });
  const scopeSame = prev.completionScope === cur.completionScope && (prev.completionBasis ?? 'standard') === (cur.completionBasis ?? 'standard');
  rows.push({
    metric: 'Profile completion',
    before: fmt(prev.completionPercentage, '%'),
    after: fmt(cur.completionPercentage, '%'),
    change: scopeSame ? dir(prev.completionPercentage, cur.completionPercentage) : 'not_comparable',
    note: scopeSame
      ? undefined
      : prev.completionScope !== cur.completionScope
        ? 'Measured over different fields (public listing vs connected Google profile), so not compared.'
        : 'Measured over a different set of Google profile fields (hours, services, attributes, media read from the full Google sync), so not compared.',
  });
  // Customer actions from Google — the real ROI evidence. Only compared when
  // both audits read them over windows of the same length.
  const pa = prev.performance, pc = cur.performance;
  const perfComparable = !!pa && !!pc && pa.days === pc.days;
  for (const [metric, key] of [['Calls from Google', 'calls'], ['Website clicks from Google', 'websiteClicks'], ['Direction requests', 'directionRequests']] as const) {
    if (!pa && !pc) continue;
    rows.push({
      metric: `${metric} (${pc?.days ?? pa?.days} days)`,
      before: pa ? String(pa[key]) : 'not measured',
      after: pc ? String(pc[key]) : 'not measured',
      change: perfComparable ? dir(pa![key], pc![key]) : 'not_comparable',
      pctChange: perfComparable ? pct(pa![key], pc![key]) : null,
      note: perfComparable ? undefined : 'Not measured in both audits (needs a Google connection each time).',
    });
  }
  const fr4VersionSame = !!prev.fr4ScoreVersion && prev.fr4ScoreVersion === cur.fr4ScoreVersion;
  const fr4Both = fr4VersionSame && prev.fr4Overall != null && cur.fr4Overall != null;
  if (prev.fr4Overall != null || cur.fr4Overall != null || prev.fr4ScoreVersion || cur.fr4ScoreVersion) {
    rows.push({
      metric: 'FR-4 audit score',
      before: prev.fr4Overall == null ? 'not measured' : `${prev.fr4Overall}`,
      after: cur.fr4Overall == null ? 'not measured' : `${cur.fr4Overall}`,
      change: fr4Both ? dir(prev.fr4Overall ?? null, cur.fr4Overall ?? null) : 'not_comparable',
      pctChange: fr4Both ? pct(prev.fr4Overall, cur.fr4Overall) : null,
      note: fr4Both ? `Score version ${cur.fr4ScoreVersion}. This is not the profile completion percentage.` : 'The FR-4 audit score and profile completion are different metrics, so they are not compared unless both audits recorded the same FR-4 score version.',
    });
  }
  return { previousAuditId: prev.auditId, previousKind: prev.kind, previousAt: prev.at, rows };
}

// ── Optimization plan ──────────────────────────────────────────────────────

export interface PlanFinding {
  id: string;
  category: string;
  title: string;
  evidence: string;
  evidenceIds: string[];
  source: string;
  severity: 'high' | 'medium' | 'low';
  actionability: string;
  growwmaticsCapability: string | null;
  recommendedAction: string;
}

export interface OptimizationItem {
  findingId: string;
  evidence: string;
  evidenceState: string;
  priority: 'high' | 'medium' | 'low';
  action: string;
  /** GrowwMatics capability that can execute it, or who must. */
  executor: string;
  executedBy: 'growwmatics_and_owner' | 'owner';
  growwmaticsAction: string | null;
  ownerAction: string;
  /** GrowwMatics can only execute it once the Google profile is connected. */
  requiresGbpConnection: boolean;
  /** Owner must confirm the facts first (website claims, anything not verified on Google). */
  requiresOwnerConfirmation: boolean;
  executionStatus: 'not_started';
  /** What is re-measured in the next audit to see whether it worked. */
  measurement: string;
}


export function buildOptimizationPlan(findings: PlanFinding[]): OptimizationItem[] {
  const order = { high: 0, medium: 1, low: 2 } as const;
  return findings
    .filter((f) => f.category !== 'data_quality' && f.actionability !== 'not_actionable' && f.actionability !== 'monitor_only')
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((f) => {
      const ex = findingExecution(f as any);
      return {
        findingId: f.id,
        evidence: f.evidence,
        evidenceState: ex.evidenceState,
        priority: f.severity,
        action: f.recommendedAction,
        executor: f.growwmaticsCapability ? `growwmatics:${f.growwmaticsCapability}` : 'owner_in_google',
        executedBy: f.growwmaticsCapability ? ('growwmatics_and_owner' as const) : ('owner' as const),
        growwmaticsAction: ex.growwmaticsAction,
        ownerAction: ex.ownerAction,
        requiresGbpConnection: ex.requiresGbpConnection,
        // Every GrowwMatics action needs the owner's go-ahead; website claims
        // and drafted text need their facts confirmed first.
        requiresOwnerConfirmation: true,
        executionStatus: 'not_started' as const,
        measurement: ex.measurement,
      };
    });
}
