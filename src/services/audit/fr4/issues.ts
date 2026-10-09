/**
 * FR-4.4 view of findings.
 *
 * Existing finding.severity is not rewritten. Critical is applied only to
 * the two cases below. OptimizationAction.status is not touched: READY still
 * means "prerequisites met", and nothing here is marked automatically executable.
 * This product has no unattended Google write, so FIXABLE_AUTOMATICALLY is unused.
 */

import type { Finding } from '../findings.ts';

export type Fr4Severity = 'critical' | 'high' | 'medium' | 'low';
export type Fixability = 'FIXABLE_AUTOMATICALLY' | 'FIXABLE_WITH_APPROVAL' | 'MANUAL_ACTION_REQUIRED' | 'NOT_SUPPORTED';

const APPROVAL_CAPABILITIES = new Set([
  'update_title', 'update_description', 'update_phone', 'update_website',
  'google_posts', 'review_replies', 'review_requests', 'photo_uploads',
]);

export function fixabilityFor(capability: string | null | undefined): Fixability {
  if (capability === 'rank_tracking') return 'NOT_SUPPORTED';
  if (capability && APPROVAL_CAPABILITIES.has(capability)) return 'FIXABLE_WITH_APPROVAL';
  return 'MANUAL_ACTION_REQUIRED';
}

export interface Fr4Issue {
  id: string;
  category: string;
  /** Existing high/medium/low, plus critical only for a measured NAP phone mismatch or a measured noindex. */
  severity: Fr4Severity;
  title: string;
  description: string;
  evidence: string;
  evidenceIds: string[];
  businessImpact: string;
  /** Relative 0–100 gap. Null when no measured gap exists. Never a revenue figure. */
  impactScore: number | null;
  impactBasis: string;
  recommendation: string;
  action: { capability: string | null; fixability: Fixability; executesAutomatically: false };
  source: string;
}

const CRITICAL = new Set(['website.nap_mismatch', 'website.not_indexable']);

export function fr4Severity(finding: Pick<Finding, 'id' | 'severity'>): Fr4Severity {
  return CRITICAL.has(finding.id) ? 'critical' : finding.severity;
}

export function impactFor(
  finding: Pick<Finding, 'id'>,
  gaps: { reviewCount?: number | null; medianReviews?: number | null },
): { impactScore: number | null; impactBasis: string } {
  if (finding.id === 'reviews.volume_gap' && gaps.reviewCount != null && gaps.medianReviews != null && gaps.medianReviews > 0) {
    const gap = Math.max(0, Math.min(100, Math.round(((gaps.medianReviews - gaps.reviewCount) / gaps.medianReviews) * 100)));
    return { impactScore: gap, impactBasis: `Review count is ${gap}% below the measured competitor median. Not a revenue estimate.` };
  }
  if (finding.id === 'website.nap_mismatch') return { impactScore: 80, impactBasis: 'Verified listing phone or name disagrees with the website. Relative priority, not revenue.' };
  if (finding.id === 'website.not_indexable') return { impactScore: 90, impactBasis: 'The site tells crawlers not to index it. Relative priority, not revenue.' };
  if (finding.id === 'website.https_off') return { impactScore: 70, impactBasis: 'The fetched page stayed on HTTP. Relative priority, not revenue.' };
  if (finding.id === 'website.schema_invalid') return { impactScore: 50, impactBasis: 'JSON-LD on the site did not parse. Relative priority, not revenue.' };
  if (finding.id === 'website.schema_missing') return { impactScore: 40, impactBasis: 'The crawl found no JSON-LD. Relative priority, not revenue.' };
  if (finding.id === 'website.map_missing') return { impactScore: 25, impactBasis: 'No Google Maps embed or Maps URL was found. Relative priority, not revenue.' };
  return { impactScore: null, impactBasis: 'No measured numeric gap for this finding. No revenue figure is estimated.' };
}

export function toFr4Issues(findings: Finding[], gaps: { reviewCount?: number | null; medianReviews?: number | null } = {}): Fr4Issue[] {
  return findings.map((f) => {
    const impact = impactFor(f, gaps);
    return {
      id: f.id,
      category: f.category,
      severity: fr4Severity(f),
      title: f.title,
      description: f.evidence,
      evidence: f.evidence,
      evidenceIds: f.evidenceIds,
      businessImpact: f.businessImpact,
      impactScore: impact.impactScore,
      impactBasis: impact.impactBasis,
      recommendation: f.recommendedAction,
      action: { capability: f.growwmaticsCapability, fixability: fixabilityFor(f.growwmaticsCapability), executesAutomatically: false },
      source: f.source,
    };
  });
}
