/**
 * Server-side WhatsApp limits for business-owner notifications. Pure (no
 * imports), so the rules run under plain `node --test`; services/ownerNotify.ts
 * applies them as single atomic MongoDB updates on the Business document.
 *
 * Routine performance updates (weekly_update, performance_digest): at most
 * PERFORMANCE_UPDATE_LIMIT per business in any rolling
 * PERFORMANCE_UPDATE_WINDOW_DAYS. Business.performanceUpdateSentAt keeps only
 * the most recent LIMIT send times ($push with $slice), so a new send is
 * allowed when fewer than LIMIT are stored or the oldest stored one is at least
 * a full window old. The check and the push are one findOneAndUpdate, so two
 * concurrent jobs (or an Inngest retry) cannot both take the last slot.
 * The monthly report summary is never held back by this check, but once it is
 * sent it is recorded with the same $push — so it counts toward the limit and
 * the routine updates around it give way.
 *
 * Reviews-need-attention reminder: once per ISO week — Business.reviewAttentionWeekKey
 * is claimed with a conditional $set, so a second run in the same week no-ops.
 */

export const PERFORMANCE_UPDATE_LIMIT = 2;
export const PERFORMANCE_UPDATE_WINDOW_DAYS = 15;
const WINDOW_MS = PERFORMANCE_UPDATE_WINDOW_DAYS * 86_400_000;

/** Whether one more performance update fits, given the stored send times. Mirrors performanceUpdateClaimFilter. */
export function performanceUpdateAllowed(sentAt: Array<Date | string> | null | undefined, now = new Date()): boolean {
  const kept = (sentAt || []).slice(-PERFORMANCE_UPDATE_LIMIT);
  if (kept.length < PERFORMANCE_UPDATE_LIMIT) return true;
  return now.getTime() - new Date(kept[0]).getTime() >= WINDOW_MS;
}

/** MongoDB filter (merged with the business _id) matching only a business that still has a slot. */
export function performanceUpdateClaimFilter(now = new Date()): Record<string, unknown> {
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  return {
    $or: [
      { [`performanceUpdateSentAt.${PERFORMANCE_UPDATE_LIMIT - 1}`]: { $exists: false } },
      { 'performanceUpdateSentAt.0': { $lte: cutoff } },
    ],
  };
}

/** The update that takes the slot: record `now`, keep only the latest LIMIT send times. */
export function performanceUpdateClaimUpdate(now = new Date()): Record<string, unknown> {
  return { $push: { performanceUpdateSentAt: { $each: [now], $slice: -PERFORMANCE_UPDATE_LIMIT } } };
}
