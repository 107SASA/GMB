import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { inngest } from '@/services/inngest/client';

/** Kept in one place — weeklyContentAutopilotCron (services/inngest/functions.ts) reads the same constant. */
export const AUTOPILOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fires a workspace's FIRST weekly-autopilot batch the moment it has both an
 * active subscription AND a connected Google Business Profile — whichever of
 * the two finishes second calls this. See the two call sites:
 *   - activateBusinessPlan (lib/billing/applyEntitlements.ts) — subscription
 *     just went active.
 *   - finalizeGbpConnection (lib/gbpConnect.ts) — Google just got connected.
 *
 * Anchors the recurring weekly cadence to right now, so "next week, same
 * day" (weeklyContentAutopilotCron) holds from this exact moment onward.
 *
 * Idempotent and race-safe: the atomic findOneAndUpdate below only succeeds
 * for the FIRST caller to see autopilotNextRunAt unset on this business — a
 * second concurrent call (e.g. subscription activation and GBP connect
 * landing within the same second) is a guaranteed no-op, not a duplicate
 * batch. Once set, autopilotNextRunAt is NEVER cleared or reset by a later
 * GBP disconnect/reconnect or a subscription lapse/resume — the weekly
 * cadence stays anchored to this original day (weeklyContentAutopilotCron
 * simply skips a business that isn't currently qualified when its turn comes
 * up, without moving its schedule).
 *
 * Best-effort: any failure here is logged and swallowed rather than thrown,
 * so it can never block the billing/OAuth flow that called it. A business
 * that misses this (e.g. this call throws, or both conditions were already
 * true before this code existed) still gets picked up — every hour,
 * weeklyContentAutopilotCron treats "qualified with no autopilotNextRunAt
 * yet" as due-now too, so nothing is silently stuck forever.
 */
export async function maybeStartContentAutopilot(businessId: string): Promise<void> {
  try {
    await dbConnect();
    const business = await Business.findById(businessId)
      .select('subscriptionStatus googleConnected keywords autopilotNextRunAt')
      .lean<{
        subscriptionStatus?: string;
        googleConnected?: boolean;
        keywords?: string[];
        autopilotNextRunAt?: Date;
      }>();
    if (!business) return;
    if (business.autopilotNextRunAt) return; // already anchored — never re-trigger
    if (business.subscriptionStatus !== 'active' || !business.googleConnected) return; // not qualified yet
    // Nothing to generate from yet — weeklyContentAutopilotCron's hourly pass
    // retries this automatically once keywords are added (onboarding intake).
    if (!Array.isArray(business.keywords) || business.keywords.length === 0) return;

    const nextRunAt = new Date(Date.now() + AUTOPILOT_INTERVAL_MS);
    const claimed = await Business.findOneAndUpdate(
      { _id: businessId, autopilotNextRunAt: { $exists: false } },
      { $set: { autopilotNextRunAt: nextRunAt } }
    );
    if (!claimed) return; // lost the race to a concurrent caller — they already dispatched

    await inngest.send({ name: 'scheduler/generate', data: { businessId, force: true, autopilot: true } });
  } catch (err) {
    console.error('[content-autopilot] maybeStartContentAutopilot failed for', businessId, err);
  }
}
