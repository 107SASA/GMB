/**
 * Joins the FR-4 pieces onto one object stored at auditData.fr4.
 * Keyword research is not an input and is not modified.
 */

import type { Finding } from '../findings.ts';
import type { SearchObservation } from '../facts.ts';
import { buildAuditScore, type Fr4ScoreInput } from './score.ts';
import { buildCompetitorBenchmark, type ReviewHistoryPoint } from './benchmark.ts';
import { buildWebsiteAudit, schemaDimension, websiteDimension, type WebsiteAuditInput } from './website.ts';
import { websiteFindings } from './websiteFindings.ts';
import { toFr4Issues } from './issues.ts';

export interface Fr4Bundle {
  version: 'fr4-v1';
  auditScore: ReturnType<typeof buildAuditScore>;
  competitorBenchmark: ReturnType<typeof buildCompetitorBenchmark>;
  websiteAudit: ReturnType<typeof buildWebsiteAudit>;
  issues: ReturnType<typeof toFr4Issues>;
  /** Measured gaps only. Unknown checks are omitted so they cannot become advice. */
  lines: string[];
}

export function assembleFr4(input: {
  score: Omit<Fr4ScoreInput, 'nap' | 'website' | 'schema'>;
  website: WebsiteAuditInput;
  observations: SearchObservation[];
  history: ReviewHistoryPoint[] | null;
  historyAt: string | null;
  now: string;
  subjectReviewCount: number | null;
  subjectPhotoCount: number | null;
  subjectPostsLast30Days: number | null;
  existingFindings: Finding[];
}): { bundle: Fr4Bundle; websiteFindings: Finding[] } {
  const websiteAudit = buildWebsiteAudit(input.website);
  const extra = websiteFindings(websiteAudit);
  const auditScore = buildAuditScore({
    ...input.score,
    nap: websiteAudit.nap.overall,
    website: websiteDimension(websiteAudit),
    schema: schemaDimension(websiteAudit),
  });
  const competitorBenchmark = buildCompetitorBenchmark({
    observations: input.observations,
    history: input.history,
    historyAt: input.historyAt,
    now: input.now,
    subjectReviewCount: input.subjectReviewCount,
    subjectPhotoCount: input.subjectPhotoCount,
    subjectPostsLast30Days: input.subjectPostsLast30Days,
  });
  const findings = [...input.existingFindings, ...extra];
  const issues = toFr4Issues(findings, {
    reviewCount: input.score.reviews.count,
    medianReviews: input.score.reviews.medianCompetitorCount,
  });
  const lines: string[] = [];
  if (auditScore.overall != null) {
    lines.push(`FR-4 audit score ${auditScore.overall}/100 from ${auditScore.measuredDimensions} measured dimensions. Profile completion is a separate metric and is not this score.`);
  }
  for (const d of auditScore.dimensions) {
    if (d.status === 'measured' && d.score != null && d.score < 100) lines.push(`${d.id}: ${d.score}/100. ${d.note}`);
  }
  const bench = competitorBenchmark.keywords[0];
  if (bench?.competitors.length) {
    const top = bench.competitors[0];
    const reviews = top.reviewCount == null ? 'review count not measured' : `${top.reviewCount} reviews`;
    lines.push(`Local-pack benchmark for "${bench.keyword}": first competitor is ${top.name} at position ${top.position} (${reviews}). The business itself is excluded.`);
  }
  if (competitorBenchmark.subject.reviewVelocityStatus === 'measured') {
    lines.push(`Review velocity ${competitorBenchmark.subject.reviewVelocityPerMonth} reviews per 30 days, from the previous measured count.`);
  }
  for (const f of extra) lines.push(`${f.title}. ${f.evidence}`);
  return {
    bundle: { version: 'fr4-v1', auditScore, competitorBenchmark, websiteAudit, issues, lines },
    websiteFindings: extra,
  };
}
