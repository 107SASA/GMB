/**
 * Single source of truth for scoring/formatting logic shared by the on-screen
 * audit report (AuditReportGrexa.tsx) and the downloaded PDF (lib/pdf/reportHtml.ts).
 * These used to be two independent copies that quietly drifted apart (different
 * suspension-risk thresholds, different rank color buckets) — import from here
 * instead of re-deriving either so the screen and the download can't disagree
 * on what a business's numbers mean.
 */

/** Rank 21 is the backend sentinel for "not in local pack" — never show as a real #21. */
export function formatRank(rank: number | null | undefined): string {
  if (rank == null || Number.isNaN(Number(rank)) || Number(rank) <= 0) return '—';
  const n = Number(rank);
  if (n > 20) return '20+';
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

export function computeSuspensionRisk(completionPct: number, reviewCount: number): SuspensionRisk {
  if (completionPct >= 70 && reviewCount >= 10) return { level: 'Low', pct: 0 };
  if (completionPct >= 40) return { level: 'Medium', pct: 45 };
  return { level: 'High', pct: 85 };
}
