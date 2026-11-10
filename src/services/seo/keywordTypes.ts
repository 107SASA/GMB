/**
 * The keyword system's shared types and limits (docs/KEYWORD_SYSTEM_PLAN.md).
 *
 * One list per business lives on the active SeoPlan (`keywordSet`): the
 * owner's keywords, the researched candidates we measured, and the month's
 * targets. Every reader — posts, profile, replies, the dashboard — uses it.
 *
 * Demand and rank come only from providers (Google Ads volume, Google Maps
 * searches, Google Business Profile search terms). Nothing here is ever an
 * AI estimate; a missing number stays null with a status that says why.
 * Pure (types + constants only).
 */
import type { AreaDemand } from '../audit/areaDemand.ts';

export const KEYWORD_LIMITS = {
  /** Owner keywords accepted at onboarding / Settings (server-enforced). */
  maxOwnerKeywords: 20,
  /** Research candidates per audit — one Google Ads volume task holds 700. */
  maxCandidates: 700,
  /** Keywords rank-checked per audit, all sets together. */
  maxRankChecked: 50,
  core: 5,
  rotating: 5,
  /** Watch keywords kept on the plan for next month's selection. */
  maxWatch: 30,
  /** A core keyword is not swapped before this many days. */
  coreLockDays: 90,
  /** Core swaps allowed per monthly run. */
  maxCoreSwapsPerRun: 2,
  /** Rank gain (positions) that counts as "moving" for a locked-in core keyword. */
  coreMinGain: 3,
  /** Owner keywords guaranteed a core slot when they score well enough. */
  ownerCoreMin: 2,
  /** An owner keyword earns its guaranteed core slot when its score is at
   *  least the score of the candidate at this position. */
  ownerCoreScoreRank: 10,
  /** Maps search points per keyword, by set. */
  points: { core: 9, rotating: 3, owner: 3, explore: 1 },
  /** Extra candidates rank-checked at one point to find quick wins. */
  explore: 20,
} as const;

export type KeywordSourceTag =
  | 'owner'
  | 'service'
  | 'service_area'
  | 'gbp_search_term'
  | 'google_ideas'
  | 'competitor'
  | 'category'
  /** A keyword the business had before (owner list beyond 20, earlier reports). */
  | 'previous';

export type KeywordRole = 'core' | 'rotating' | 'owner' | 'watch';

export type KeywordVerdict =
  | 'quick_win'    // rank 4–10 with demand
  | 'defend'       // already top 3
  | 'strong'       // good demand, winnable
  | 'hard'         // strong competitors / far off
  | 'low_demand'   // Google reports too few searches and no customer impressions
  | 'not_relevant' // matches no verified service or category
  | 'claim_word'   // owner keyword with "best" / "top" — posts can't use it
  | 'new';         // not rank-checked yet

/** How relevant a keyword is, from the service it matches. */
export type RelevanceSource = 'gbp' | 'category' | 'owner' | 'website' | 'generic' | 'none';

export interface KeywordVolume {
  /** Google Ads monthly searches for the exact phrase, country-wide. */
  country: number | null;
  /** Same phrase at the business's city Ads location, when measured. */
  city: number | null;
  /** The broad service term in the city / state (areaDemand.ts). */
  area: AreaDemand | null;
  status: 'measured' | 'too_few_searches' | 'not_measured';
  measuredAt: string | null;
}

export interface KeywordRank {
  /** Mean position over the points where the business was found (1–20). */
  avg: number | null;
  best: number | null;
  /** Share of searched points where the business was in the top 20 (0–1). */
  foundPct: number;
  points: number;
  status: 'measured' | 'unavailable' | 'not_measured';
}

export interface CompetitorAbove {
  name: string;
  rank: number;
  reviews: number | null;
  rating: number | null;
}

/** One researched keyword before selection (keywordResearch.ts output). */
export interface KeywordCandidate {
  id: string;
  keyword: string;
  sources: KeywordSourceTag[];
  owner: boolean;
  serviceId: string | null;
  service: string | null;
  relevance: RelevanceSource;
  /** Volume the keyword-ideas call already returned (country/city per its location). */
  ideaVolume: number | null;
  /** Latest Google Business Profile impressions for this exact search term. */
  gbpImpressions: number | null;
  /** Competitor whose website ranks for it (source 'competitor'). */
  competitor: string | null;
}

/** A candidate with its measurements and score (keywordScore.ts output). */
export interface ScoredKeyword extends KeywordCandidate {
  volume: KeywordVolume;
  rank: KeywordRank;
  competitorsAbove: CompetitorAbove[];
  score: number;
  demand: number;
  winnability: number;
  verdict: KeywordVerdict;
  reason: string;
}

/** One row of SeoPlan.keywordSet. */
export interface PlanKeyword extends ScoredKeyword {
  role: KeywordRole;
  /** When it became core (ISO) — the 90-day lock starts here. */
  coreSince?: string;
  /** Average rank when it became core; 21 = not in the top 20. */
  coreStartRank?: number;
  /** Positions moved vs. the previous plan; positive = better. */
  rankTrend: number | null;
  /** Owner override: never swapped out. */
  pinned?: boolean;
}

export interface KeywordSetChange {
  id: string;
  keyword: string;
  change: 'core_added' | 'core_kept' | 'core_removed' | 'rotating_added' | 'rotating_removed';
  reason: string;
}

export interface CompetitorGap {
  keyword: string;
  volume: number | null;
  competitor: string;
  /** Their Google Maps position; null = found via their website's keywords, not a Maps search. */
  competitorRank: number | null;
}
