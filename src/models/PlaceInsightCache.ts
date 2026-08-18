import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Shared, googlePlaceId-keyed cache of the expensive fastMode audit outputs
 * (DataForSEO rank/competitor data + the AI-written narrative). Exists
 * because every /free-report visitor gets their OWN Business document (see
 * shadowAccount.ts) — two different leads asking about the SAME real Google
 * listing previously reran the entire paid pipeline twice, with nothing
 * shared between them. Keying by googlePlaceId instead of Business._id is
 * what actually fixes that: the underlying facts (rank, competitors, AI
 * narrative) are properties of the real Google Business Profile, not of
 * whichever visitor happened to ask about it, so serving Lead B the data
 * computed for Lead A is not a shortcut — it's the same true answer.
 *
 * INTENTIONALLY SCOPED TO fastMode (free-report / lead-gen) audits only —
 * see auditService.ts. Paying customers' dashboard audits (POST /api/audit)
 * can pick a review window (7/14/21 days) and action-plan duration
 * (30/45/90 days) per request, and realistically never collide with another
 * customer auditing the exact same googlePlaceId at the same time, so a
 * shared cross-request cache wouldn't save anything there and would only
 * risk serving a customer's chosen options for a different one — not built.
 *
 * NOTE: there is deliberately no reviews block here. fastMode already never
 * calls SerpApi for reviews (see needsReviewSync in auditService.ts — it's
 * gated on !audit.fastMode), so there is no live-review API cost to dedupe
 * for fastMode in the first place; its review numbers come from each
 * visitor's own Places snapshot, captured at their own intake. Caching that
 * would add complexity for zero API-cost savings.
 */

export interface IPlaceInsightCache extends Document {
  googlePlaceId: string;

  /** DataForSEO geo-grid rank + Google Places competitor search — the two
   *  real per-call costs of a fastMode report. */
  rank?: {
    legacyRankings: any[];
    geoGridRank: any;
    localPackCompetitors: any[];
    rankingsEvidence: string;
    accepted: any[];
    rejected: any[];
    targetTier: string;
    compEvidence: string;
    fetchedAt: Date;
    /** Which build of the keyword/competitor-resolution logic produced this
     *  entry — see CACHE_LOGIC_VERSION in auditService.ts. A mismatch means
     *  the code has changed since this was cached (e.g. how the search
     *  keyword is derived from category/name), so it's treated as stale
     *  regardless of fetchedAt/TTL — without this, a logic fix can be
     *  silently shadowed by its own now-wrong cached output for up to the
     *  full TTL window. (First hit: Aug 2026, the generic-category →
     *  name-derived-keyword fix for Desun Technology was invisible for ~40
     *  minutes because the pre-fix "services kolkata" cache was still
     *  within its 7-day TTL.) */
    logicVersion: number;
  };
  /** Set atomically while a live DataForSEO/Places call for this
   *  googlePlaceId is in flight, so a second concurrent fastMode request for
   *  the SAME place (e.g. two leads submitting within seconds of each
   *  other) waits for that result instead of also paying for its own —
   *  without this, the cache only dedupes sequential repeat visits, not
   *  genuinely concurrent ones. Cleared the moment `rank` is written; if a
   *  claim is older than the staleness window, treated as an abandoned job
   *  (crashed worker) rather than a permanent lock. See auditService.ts. */
  rankPendingSince?: Date;

  /** The AI-authored (Groq) portions of the report. Invalidated by
   *  inputsHash — a hash of the native numbers the narrative was written
   *  about — so a rank/review change forces regeneration even inside the
   *  TTL window, not just the TTL alone. */
  narrative?: {
    inputsHash: string;
    aiFields: {
      profileScore: any;
      keywordGapAnalysis: any[];
      reviewAnalysisNarrative: { mostCommonPraises: string[]; mostCommonComplaints: string[] };
      strengths: any[];
      weaknesses: any[];
      priorityFixes: any[];
      thirtyDayPlan: any[];
      ninetyDayPlan: any[];
      actionPlan: any;
    };
    fetchedAt: Date;
    /** Same purpose as rank.logicVersion — guards against e.g. a change to
     *  generateNativePriorityFixes' Missing-vs-Unknown handling being
     *  invisible to inputsHash (which only covers the numeric facts fed in,
     *  not the code that turns them into text). */
    logicVersion: number;
  };
  /** Same purpose as rankPendingSince, for the Groq narrative call. */
  narrativePendingSince?: Date;
}

const PlaceInsightCacheSchema = new Schema<IPlaceInsightCache>(
  {
    googlePlaceId: { type: String, required: true, unique: true, index: true },
    rank: { type: Schema.Types.Mixed },
    rankPendingSince: { type: Date },
    narrative: { type: Schema.Types.Mixed },
    narrativePendingSince: { type: Date },
  },
  { timestamps: true },
);

const PlaceInsightCache: Model<IPlaceInsightCache> =
  mongoose.models.PlaceInsightCache || mongoose.model<IPlaceInsightCache>('PlaceInsightCache', PlaceInsightCacheSchema);

export default PlaceInsightCache;

// ── Claim/wait helpers ──────────────────────────────────────────────────
// Prevent the dogpile case: two fastMode requests for the SAME googlePlaceId
// landing close enough together that both see a cache miss and both fire
// the full DataForSEO+Places(+Groq) chain — the exact duplicate-cost
// scenario the cache exists to prevent, just at sub-second granularity
// instead of across days. A findOne-then-later-updateOne isn't atomic, so a
// claim has to be its own atomic write, separate from the cached data.

const CLAIM_STALE_MS: Record<'rank' | 'narrative', number> = {
  rank: 90 * 1000,       // generous headroom over the ~15-40s a full grid can take
  narrative: 60 * 1000,  // Groq calls are typically a few seconds
};
const CLAIM_WAIT_BUDGET_MS: Record<'rank' | 'narrative', number> = {
  rank: 25 * 1000,
  narrative: 20 * 1000,
};
const CLAIM_POLL_INTERVAL_MS = 1500;

/**
 * Atomically claim the right to (re)compute `field` for this googlePlaceId.
 * Returns true if this call won the claim (proceed to compute + upsert,
 * then release via the same update that writes the result). Returns false
 * if another request already holds a live claim (caller should wait via
 * waitForInsightRefresh instead of also paying for its own fetch).
 *
 * A claim older than CLAIM_STALE_MS is treated as abandoned (the job that
 * held it crashed or never released it) rather than a permanent lock, so a
 * single failed job can't jam this googlePlaceId's cache forever.
 */
export async function claimInsightRefresh(
  googlePlaceId: string,
  field: 'rank' | 'narrative',
): Promise<boolean> {
  const pendingField = `${field}PendingSince`;
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_MS[field]);
  const myClaimTime = new Date();
  try {
    const doc = await PlaceInsightCache.findOneAndUpdate(
      {
        googlePlaceId,
        $or: [{ [pendingField]: { $exists: false } }, { [pendingField]: { $lt: staleThreshold } }],
      },
      { $set: { [pendingField]: myClaimTime }, $setOnInsert: { googlePlaceId } },
      { upsert: true, new: true },
    );
    return (doc as any)?.[pendingField]?.getTime() === myClaimTime.getTime();
  } catch (err: any) {
    // Lost the upsert race to a concurrent claimant (duplicate key on the
    // unique googlePlaceId index) — they're refreshing, we're not.
    if (err?.code === 11000) return false;
    throw err;
  }
}

/**
 * Poll briefly for another in-flight claim on `field` to land. Bounded by
 * CLAIM_WAIT_BUDGET_MS so a slow or crashed claimant can't hang this
 * request indefinitely — on timeout, the caller should fall through to
 * computing the data itself (accepting the duplicate cost in that rare
 * case, rather than waiting forever).
 */
export async function waitForInsightRefresh(
  googlePlaceId: string,
  field: 'rank' | 'narrative',
  isUsable: (doc: IPlaceInsightCache) => boolean,
) {
  const deadline = Date.now() + CLAIM_WAIT_BUDGET_MS[field];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_INTERVAL_MS));
    const doc = await PlaceInsightCache.findOne({ googlePlaceId });
    if (doc && isUsable(doc)) return doc;
  }
  return null;
}
