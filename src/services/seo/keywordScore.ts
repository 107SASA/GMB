/**
 * S3 — score every measured keyword (docs/KEYWORD_SYSTEM_PLAN.md §5). Pure.
 *
 *   score = demand × relevance × winnability
 *
 * demand      log10(1 + monthly searches) — city volume, else country volume,
 *             else half the broad term's city/state demand; else log10(1 +
 *             GBP impressions); else a small floor for owner/service keywords.
 * relevance   from the service the keyword matches (GBP-listed strongest).
 * winnability from the observed Google Maps rank, reduced when the
 *             businesses above us have far more reviews.
 *
 * Inputs are provider numbers only. The reason text is built from the same
 * numbers, so it never claims more than was measured.
 */
import type {
  CompetitorAbove,
  KeywordCandidate,
  KeywordRank,
  KeywordVerdict,
  KeywordVolume,
  RelevanceSource,
  ScoredKeyword,
} from './keywordTypes.ts';
import { CLAIM } from './keywordResearch.ts';

export const RELEVANCE_WEIGHT: Record<RelevanceSource, number> = {
  gbp: 1,
  category: 1,
  owner: 0.8,
  website: 0.6,
  generic: 0.25, // only a vague Google category ("Store") — used when nothing better exists
  none: 0.5, // owner keyword with no service match — measured, rarely targeted
};

const NO_DATA_FLOOR = { known: 0.3, other: 0.1 };
const STRONG_COMPETITION_RATIO = 5;
const STRONG_COMPETITION_MIN_REVIEWS = 25;

export interface ScoreInput {
  candidate: KeywordCandidate;
  volume: KeywordVolume;
  rank: KeywordRank;
  competitorsAbove: CompetitorAbove[];
  /** The business's own Google review count (null = unknown). */
  ourReviews: number | null;
}

/** The monthly-searches number the score uses, and where it came from. */
export function bestDemand(volume: KeywordVolume, ideaVolume: number | null): { searches: number | null; basis: 'city' | 'country' | 'area' | 'none' } {
  const pos = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : null);
  if (pos(volume.city)) return { searches: volume.city, basis: 'city' };
  if (pos(volume.country)) return { searches: volume.country, basis: 'country' };
  if (pos(ideaVolume)) return { searches: ideaVolume, basis: 'country' };
  if (pos(volume.area?.searchVolume)) return { searches: Math.round(volume.area!.searchVolume! * 0.5), basis: 'area' };
  return { searches: null, basis: 'none' };
}

function strongCompetition(above: CompetitorAbove[], ourReviews: number | null): boolean {
  const top = above.slice(0, 3).map((c) => c.reviews).filter((n): n is number => typeof n === 'number');
  if (!top.length) return false;
  const avg = top.reduce((a, b) => a + b, 0) / top.length;
  if (!ourReviews || ourReviews < 1) return avg >= STRONG_COMPETITION_MIN_REVIEWS;
  return avg >= ourReviews * STRONG_COMPETITION_RATIO;
}

export function winnabilityOf(rank: KeywordRank, strong: boolean): number {
  let w: number;
  if (rank.status !== 'measured' || rank.avg == null) w = 0.4;
  else if (rank.avg <= 3) w = 0.6;
  else if (rank.avg <= 10) w = 1;
  else w = 0.8;
  return strong ? w * 0.7 : w;
}

const fmt = (n: number) => n.toLocaleString('en-IN');

export function scoreKeyword(input: ScoreInput): ScoredKeyword {
  const { candidate: c, volume, rank, competitorsAbove, ourReviews } = input;
  const demandNum = bestDemand(volume, c.ideaVolume);
  const impressions = c.gbpImpressions && c.gbpImpressions > 0 ? c.gbpImpressions : null;
  const known = c.owner || c.sources.some((s) => s === 'service' || s === 'category' || s === 'service_area');

  const demand = demandNum.searches != null
    ? Math.log10(1 + demandNum.searches)
    : impressions != null
      ? Math.log10(1 + impressions)
      : known ? NO_DATA_FLOOR.known : NO_DATA_FLOOR.other;

  const relevance = RELEVANCE_WEIGHT[c.relevance];
  const strong = strongCompetition(competitorsAbove, ourReviews);
  const winnability = winnabilityOf(rank, strong);
  const score = Math.round(demand * relevance * winnability * 1000) / 1000;

  const measured = rank.status === 'measured';
  const avg = measured ? rank.avg : null;
  const hasDemand = demandNum.searches != null || impressions != null;

  let verdict: KeywordVerdict;
  if (c.relevance === 'none') verdict = 'not_relevant';
  else if (CLAIM.test(c.keyword)) verdict = 'claim_word'; // only owner keywords get this far
  else if (!hasDemand && volume.status !== 'not_measured') verdict = 'low_demand';
  else if (!measured) verdict = 'new';
  else if (avg != null && avg <= 3) verdict = 'defend';
  else if (avg != null && avg <= 10 && hasDemand) verdict = 'quick_win';
  else if (winnability <= 0.3) verdict = 'hard';
  else verdict = 'strong';

  return {
    ...c,
    volume,
    rank,
    competitorsAbove: competitorsAbove.slice(0, 3),
    score,
    demand: Math.round(demand * 1000) / 1000,
    winnability,
    verdict,
    reason: reasonFor({ verdict, demandNum, impressions, avg, rank, service: c.service, top: competitorsAbove[0] ?? null, strong }),
  };
}

function reasonFor(x: {
  verdict: KeywordVerdict;
  demandNum: { searches: number | null; basis: 'city' | 'country' | 'area' | 'none' };
  impressions: number | null;
  avg: number | null;
  rank: KeywordRank;
  service: string | null;
  top: CompetitorAbove | null;
  strong: boolean;
}): string {
  const parts: string[] = [];
  const { searches, basis } = x.demandNum;
  if (searches != null) {
    parts.push(basis === 'area'
      ? `the broader service gets about ${fmt(searches * 2)} searches a month in your area`
      : `${fmt(searches)} Google searches a month${basis === 'city' ? ' in your city' : ''}`);
  } else if (x.impressions != null) {
    parts.push(`${fmt(x.impressions)} customers saw your profile from this search on Google`);
  } else {
    parts.push('Google reports too few searches for this exact phrase');
  }
  if (x.rank.status !== 'measured') parts.push('your rank is checked from the next report');
  else if (x.avg == null) parts.push('you are not in the top 20 on Google Maps yet');
  else parts.push(`you are #${Math.round(x.avg)} on Google Maps`);
  if (x.top && x.verdict !== 'defend') parts.push(`${x.top.name} is #${x.top.rank}${x.strong ? ' with many more reviews' : ''}`);

  const lead: Record<KeywordVerdict, string> = {
    quick_win: 'Quick win',
    defend: 'Keep your top-3 spot',
    strong: 'Good opportunity',
    hard: 'Hard for now',
    low_demand: 'Few searches',
    not_relevant: 'Not tied to a listed service',
    claim_word: 'Uses “best” / “top”, which posts can’t use — tracked, not targeted',
    new: 'New keyword',
  };
  return `${lead[x.verdict]}: ${parts.join('; ')}.`;
}
