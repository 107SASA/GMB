/**
 * One display vocabulary for every report surface — free report, dashboard
 * report, PDF, static map images and WhatsApp. Numbers come from the facts
 * layer (facts.ts); this file only decides how a verified value is WORDED.
 *
 * Rules:
 *  - A found search shows its real position ("#14", averages "#7.5").
 *  - A search that did not find the business shows "Not found" — never
 *    "20+", "21" or any other stand-in rank.
 *  - A search the provider failed on shows "Unavailable".
 *  - Anything we could not measure shows "Unknown" / "Not measured".
 *
 * Old audits (created before the facts layer existed) stored not-found as a
 * numeric 21 and cannot tell not-found from provider failure; their values
 * are shown as "Not found" with a legacy notice on the report.
 *
 * Pure: no I/O, no `@/` imports (runs under `node --test`).
 */

import { LOCAL_PACK_WINDOW } from './facts.ts';
import type { RankingSummary } from './facts.ts';

export type RankState = 'found' | 'not_found' | 'unavailable' | 'unknown';

export interface RankValue {
  state: RankState;
  /** Real position (may be an average) when state is 'found'. */
  rank: number | null;
}

/** New-engine value (explicit found/status) or a legacy number (21 = not found). */
export function toRankValue(input: {
  found?: boolean | null;
  rank?: number | null;
  status?: 'ok' | 'unavailable' | string | null;
} | number | null | undefined): RankValue {
  if (input == null) return { state: 'unknown', rank: null };
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return { state: 'unknown', rank: null };
    return input > LOCAL_PACK_WINDOW ? { state: 'not_found', rank: null } : { state: 'found', rank: input };
  }
  if (input.status === 'unavailable') return { state: 'unavailable', rank: null };
  if (input.found === false) return { state: 'not_found', rank: null };
  if (typeof input.rank === 'number' && input.rank > 0 && input.rank <= LOCAL_PACK_WINDOW) {
    return { state: 'found', rank: input.rank };
  }
  if (input.found === true) return { state: 'unknown', rank: null };
  return typeof input.rank === 'number' && input.rank > LOCAL_PACK_WINDOW
    ? { state: 'not_found', rank: null }
    : { state: 'unknown', rank: null };
}

export function rankLabel(v: RankValue): string {
  switch (v.state) {
    case 'found': {
      const r = v.rank as number;
      return `#${Number.isInteger(r) ? r : r.toFixed(1)}`;
    }
    case 'not_found': return 'Not found';
    case 'unavailable': return 'Unavailable';
    default: return 'Unknown';
  }
}

/** Colour band — the SAME bands on every map, table and legend. */
export type RankBand = 'top5' | 'top20' | 'not_found' | 'unavailable';

export function rankBand(v: RankValue): RankBand {
  if (v.state === 'found') return (v.rank as number) <= 5 ? 'top5' : 'top20';
  if (v.state === 'not_found') return 'not_found';
  return 'unavailable';
}

export const RANK_BAND_HEX: Record<RankBand, string> = {
  top5: '#0a8a3e',
  top20: '#fab219',
  not_found: '#ba1a1a',
  unavailable: '#94a3b8',
};

export const RANK_LEGEND: Array<{ band: RankBand; label: string; hex: string }> = [
  { band: 'top5', label: 'Top 5', hex: RANK_BAND_HEX.top5 },
  { band: 'top20', label: '6–20', hex: RANK_BAND_HEX.top20 },
  { band: 'not_found', label: 'Not found in top 20', hex: RANK_BAND_HEX.not_found },
  { band: 'unavailable', label: 'Unavailable', hex: RANK_BAND_HEX.unavailable },
];

/** Google Static Maps marker colour for a band ("0xRRGGBB"). */
export function staticMapColor(band: RankBand): string {
  return `0x${RANK_BAND_HEX[band].slice(1)}`;
}

const pct = (r: number | null | undefined) => (r == null ? 'Not measured' : `${Math.round(r * 100)}%`);

/** The six ranking statistics, all over the same denominator (valid searches). */
export function rankingStatRows(s: RankingSummary | null | undefined): Array<{ label: string; value: string }> {
  if (!s || s.status === 'not_run') {
    return [{ label: 'Searches measured', value: 'Not measured' }];
  }
  if (s.status === 'unavailable') {
    return [{ label: 'Searches measured', value: `0 of ${s.totalSearches} (ranking provider unavailable)` }];
  }
  return [
    { label: 'Searches measured', value: s.status === 'partial' ? `${s.testedCount} of ${s.totalSearches}` : String(s.testedCount) },
    { label: 'Searches where you were found', value: `${s.foundCount} of ${s.testedCount}` },
    { label: 'Visibility (found in top 20)', value: pct(s.visibilityRate) },
    { label: 'Top 3', value: pct(s.top3Rate) },
    { label: 'Top 5', value: pct(s.top5Rate) },
    ...(s.top10Rate !== undefined ? [{ label: 'Top 10', value: pct(s.top10Rate) }] : []),
    { label: 'Average observed rank', value: s.averageObservedRank != null ? `#${s.averageObservedRank}` : 'Not found in any search' },
  ];
}

// ── Profile completion ─────────────────────────────────────────────────────

export interface CompletionBreakdown {
  known: number;
  complete: number;
  missing: number;
  unknown: number;
  pct: number | null;
}

/** The single completion formula: complete ÷ (complete + missing). Unknown is excluded. */
export function completionBreakdown(checklist: Array<{ status: string }> | null | undefined): CompletionBreakdown {
  const rows = checklist || [];
  const complete = rows.filter((r) => r.status === 'Complete' || r.status === 'Partial').length;
  const missing = rows.filter((r) => r.status === 'Missing').length;
  const unknown = rows.length - complete - missing;
  const known = complete + missing;
  return { known, complete, missing, unknown, pct: known > 0 ? Math.round((complete / known) * 100) : null };
}

export function completionSentence(b: CompletionBreakdown): string {
  if (b.pct == null) return 'Profile completion could not be measured — none of the fields could be checked.';
  return `${b.complete} of ${b.known} checked fields complete (${b.pct}%) · ${b.missing} missing · ${b.unknown} could not be checked and are not counted.`;
}

// ── Reviews ────────────────────────────────────────────────────────────────

export interface ReviewDisplay {
  lifetimeCount: string;
  lifetimeRating: string;
  recentCount: string;
  recentPeriod: string;
  reviewsPerWeek: string;
  responseRate: string;
  themes: string;
}

export function reviewDisplay(facts: any, themes?: { praises?: string[]; complaints?: string[] } | 'unknown' | null): ReviewDisplay {
  const lt = facts?.lifetime;
  const rc = facts?.recent;
  const synced = rc?.status === 'verified';
  const themeText =
    themes && themes !== 'unknown' && ((themes.praises?.length || 0) + (themes.complaints?.length || 0) > 0)
      ? [
          themes.praises?.length ? `Praised: ${themes.praises.join(', ')}` : '',
          themes.complaints?.length ? `Complaints: ${themes.complaints.join(', ')}` : '',
        ].filter(Boolean).join(' · ')
      : 'Review themes unavailable because review text was not available.';
  return {
    lifetimeCount: lt?.status === 'verified' && lt.totalCount != null ? String(lt.totalCount) : 'Unknown',
    lifetimeRating: lt?.status === 'verified' && lt.rating != null ? `${lt.rating}★` : 'Unknown',
    recentCount: synced && rc.newReviewCount != null ? String(rc.newReviewCount) : 'Not measured',
    recentPeriod: rc?.periodDays ? `last ${rc.periodDays} days` : '—',
    reviewsPerWeek: synced && rc.reviewsPerWeek != null ? `${rc.reviewsPerWeek}/week` : 'Unknown',
    responseRate: synced && rc.responseRate != null
      ? `${Math.round(rc.responseRate * 100)}%`
      : synced && (rc.replyUnknownCount ?? 0) > 0
        ? 'Unknown — reply status not yet re-synced'
        : synced && (rc.newReviewCount ?? 0) === 0 ? 'No reviews in period' : 'Unknown',
    themes: themeText,
  };
}

// ── Actionability wording ──────────────────────────────────────────────────

// ── Competitor tiers (measured, never inferred from one sighting) ─────────

/**
 * 1. Consistently above you — above you in ≥ 2 searches and ≥ half of them
 * 2. Often above you        — above you in ≥ 2 searches
 * 3. Frequently visible     — in the top 20 in ≥ half the searches, above you at most once
 * 4. Seen above you once    — a single sighting; never called a major competitor
 * Places-fallback rows (no ranking evidence) are labelled as such.
 */
export function competitorTierLabel(
  c: { relevance?: string | null; searchesAhead?: number | null; appearances?: number | null },
  searches: number,
): string {
  if (c.relevance === 'unmeasured') return 'Nearby business — not from ranking results';
  if (c.relevance === 'strong') return 'Consistently above you';
  if (c.relevance === 'moderate') return 'Often above you';
  if (c.appearances != null && searches > 0 && c.appearances / searches >= 0.5) return 'Frequently visible, rarely above you';
  if (c.relevance === 'incidental') return 'Seen above you once';
  return '';
}

export const ACTIONABILITY_LABEL: Record<string, string> = {
  directly_fixable: 'You can fix this directly',
  indirectly_influenceable: 'Improves with ongoing work',
  monitor_only: 'For awareness — monitor',
  not_actionable: 'Not something you can change',
  unknown: 'Fixability unknown',
};

export const SEVERITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

// ── Suspension / policy ────────────────────────────────────────────────────

export const POLICY_UNVERIFIED_NOTE = 'Policy compliance could not be fully verified from the available data.';

export function suspensionDisplay(risk: { level?: string; reasons?: string[] } | null | undefined): { level: string; note: string } {
  if (!risk?.level) return { level: 'Not assessed', note: 'This report did not run a policy check.' };
  const first = risk.reasons?.[0];
  return {
    level: risk.level,
    note: first
      ? first
      : `No issues found in the business-title check. ${POLICY_UNVERIFIED_NOTE}`,
  };
}

/** Old audits lack the facts layer; every surface shows this notice for them. */
export const LEGACY_REPORT_NOTICE =
  'This report was generated by an earlier version of our audit engine. Some figures (such as average rank and "not found" searches) were calculated with older methods. Re-run the audit for up-to-date, fully verified numbers.';

export function isLegacyAudit(auditData: any): boolean {
  return !auditData?.facts;
}

// ── Static map (free report, dashboard, PDF) ───────────────────────────────

export interface MapPointInput {
  lat: number;
  lng: number;
  rank: number | null;
  found?: boolean;
  status?: 'ok' | 'unavailable' | string;
}

/**
 * Google Static Maps URL for a rank grid. Only real searched points are
 * drawn (no padding to a 3×3 shape), coloured with the shared RANK bands;
 * found ranks 1–9 carry their number as the marker label.
 */
export function buildRankMapUrl(opts: {
  points: MapPointInput[];
  center?: { lat: number; lng: number } | null;
  apiKey: string;
  size?: string;
  zoom?: number;
}): string {
  const pts = opts.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 25);
  const center = opts.center ?? {
    lat: pts.reduce((s, p) => s + p.lat, 0) / Math.max(1, pts.length),
    lng: pts.reduce((s, p) => s + p.lng, 0) / Math.max(1, pts.length),
  };
  const params: string[] = [
    `size=${opts.size ?? '640x360'}`,
    'scale=2',
    'maptype=roadmap',
    'style=feature:poi%7Celement:labels%7Cvisibility:off',
    'style=feature:transit%7Cvisibility:off',
  ];
  if (opts.zoom) params.push(`center=${center.lat},${center.lng}`, `zoom=${opts.zoom}`);
  for (const p of pts) {
    const v = toRankValue(p.found === undefined && p.status === undefined ? p.rank : { found: p.found ?? p.rank != null, rank: p.rank, status: p.status as any });
    const band = rankBand(v);
    const label = v.state === 'found' && (v.rank as number) <= 9 && Number.isInteger(v.rank) ? `%7Clabel:${v.rank}` : '';
    params.push(`markers=color:${staticMapColor(band)}%7Csize:mid${label}%7C${p.lat},${p.lng}`);
  }
  params.push(`markers=color:0x1d4ed8%7Csize:small%7Clabel:Y%7C${center.lat},${center.lng}`);
  params.push(`key=${encodeURIComponent(opts.apiKey)}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`;
}
