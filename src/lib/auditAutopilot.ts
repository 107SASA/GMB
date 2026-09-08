import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Audit from '@/models/Audit';
import Organization from '@/models/Organization';
import User from '@/models/User';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { incrementUsage } from '@/lib/featureGating';
import { notifyBusinessUsers } from '@/services/notifications';
import { notifyOwner } from '@/services/ownerNotify';

/** Exact-one-month cadence, matching the old seoPlanMonthlyReaudit cutoff. */
export const AUDIT_AUTOPILOT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** How often at most the "add your business category" nudge is re-sent. */
const CATEGORY_NUDGE_THROTTLE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 'Local Business' is the generic placeholder Business.create() falls back to
 * (see src/lib/shadowAccount.ts / src/app/api/onboarding). A full audit needs
 * a real category — POST /api/audit itself 400s without one — so it's treated
 * the same as missing here.
 */
export function hasRealAuditCategory(business: {
  userDefinedCategory?: string | null;
  category?: string | null;
}): boolean {
  const cat = (business.userDefinedCategory || business.category || '').trim();
  return !!cat && cat.toLowerCase() !== 'local business';
}

/**
 * Fires a workspace's FIRST automatic audit the moment it has an active
 * subscription AND a connected Google Business Profile AND a real business
 * category — then anchors the recurring 30-day cadence to that moment.
 *
 * Call sites (each fires this when the condition it owns becomes true):
 *   - activateBusinessPlan  (lib/billing/applyEntitlements.ts) — subscription active
 *   - finalizeGbpConnection (lib/gbpConnect.ts)                — Google connected
 *   - POST /api/onboarding/intake                             — category filled
 * auditAutopilotCron (hourly) is the safety net for anything the hooks miss,
 * plus it drives the recurring monthly re-audit.
 *
 * Idempotent + race-safe: the atomic findOneAndUpdate only succeeds for the
 * FIRST caller to see auditAutopilotNextRunAt unset. Once set it is never
 * cleared — a later GBP disconnect / subscription lapse just makes the cron
 * skip this business when its turn comes up, without moving the schedule
 * (same contract as autopilotNextRunAt for weekly content).
 *
 * Best-effort: every failure is logged and swallowed so it can never block
 * the billing / OAuth / intake flow that called it.
 */
export async function maybeStartAuditAutopilot(businessId: string): Promise<void> {
  try {
    await dbConnect();
    const business = await Business.findById(businessId)
      .select(
        'name subscriptionStatus googleConnected category userDefinedCategory ' +
          'auditAutopilotNextRunAt auditAutopilotCategoryNudgedAt organizationId userId phone'
      )
      .lean<{
        _id: any;
        name?: string;
        subscriptionStatus?: string;
        googleConnected?: boolean;
        category?: string;
        userDefinedCategory?: string;
        auditAutopilotNextRunAt?: Date;
        auditAutopilotCategoryNudgedAt?: Date;
        organizationId?: any;
        userId?: any;
        phone?: string;
      }>();

    if (!business) return;
    if (business.auditAutopilotNextRunAt) return; // already anchored — never re-trigger
    if (business.subscriptionStatus !== 'active' || !business.googleConnected) return; // not qualified yet

    if (!hasRealAuditCategory(business)) {
      await nudgeForCategory(business);
      return;
    }

    await claimAndDispatch(businessId);
  } catch (err) {
    console.error('[audit-autopilot] maybeStartAuditAutopilot failed for', businessId, err);
  }
}

/**
 * Atomically claims the anchor (unset → now+30d) and, only if this call won
 * the claim, creates + dispatches a full audit. Shared by maybeStart above
 * and auditAutopilotCron's first-run path. Returns true if an audit was
 * dispatched.
 */
export async function claimAndDispatch(businessId: string): Promise<boolean> {
  const nextRunAt = new Date(Date.now() + AUDIT_AUTOPILOT_INTERVAL_MS);
  const claimed = await Business.findOneAndUpdate(
    { _id: businessId, auditAutopilotNextRunAt: { $exists: false } },
    { $set: { auditAutopilotNextRunAt: nextRunAt } },
    { new: false }
  ).lean<any>();
  if (!claimed) return false; // lost the race to a concurrent caller

  return dispatchAuditForBusiness(claimed, 'audit-autopilot-first-run');
}

/**
 * Builds the org/user context a headless audit needs and dispatches it.
 * `business` is a plain object (lean or the pre-update findOneAndUpdate
 * result). Bumps the tracked audit usage counter — per product decision,
 * automatic audits are counted but never blocked by the plan quota.
 */
export async function dispatchAuditForBusiness(business: any, trigger: string): Promise<boolean> {
  try {
    if (business.isDeleted) return false;

    // Don't stack a second audit on top of one already in flight.
    const pending = await Audit.exists({ businessId: business._id, status: 'PENDING' });
    if (pending) return false;

    const org = business.organizationId ? await Organization.findById(business.organizationId).lean() : null;
    const user = business.userId ? await User.findById(business.userId).lean() : null;
    if (!org || !user) {
      console.warn(`[audit-autopilot] business ${business._id} missing org/user — skipping ${trigger}`);
      return false;
    }

    await createPendingAuditAndDispatch(business, org, user, { fastMode: false, trigger });
    await incrementUsage(business._id.toString(), 'audits').catch(() => {});
    return true;
  } catch (err: any) {
    console.error(`[audit-autopilot] dispatch failed for business ${business?._id} (${trigger}):`, err?.message);
    return false;
  }
}

/**
 * The owner is subscribed + Google-connected but hasn't given a real
 * category yet, so the first report can't be built. New workspaces are
 * hard-gated into /dashboard/onboarding/intake (src/proxy.ts) which collects
 * this — but pre-gate workspaces, or a lull between the two conditions
 * landing, can reach here. Nudge in-app + WhatsApp, throttled, and let the
 * hourly cron pick the audit up the moment a category exists.
 */
async function nudgeForCategory(business: {
  _id: any;
  name?: string;
  auditAutopilotCategoryNudgedAt?: Date;
}): Promise<void> {
  const last = business.auditAutopilotCategoryNudgedAt
    ? new Date(business.auditAutopilotCategoryNudgedAt).getTime()
    : 0;
  if (Date.now() - last < CATEGORY_NUDGE_THROTTLE_MS) return;

  await Business.updateOne(
    { _id: business._id },
    { $set: { auditAutopilotCategoryNudgedAt: new Date() } }
  );

  const name = business.name || 'your business';
  await notifyBusinessUsers(business._id.toString(), {
    type: 'profile_incomplete',
    title: 'Add your business category',
    body: `We're ready to generate ${name}'s Google Business Profile report automatically — just add your business category to your profile so we can build it.`,
    link: '/dashboard/onboarding/intake',
  }).catch(() => {});

  await notifyOwner(business._id.toString(), {
    event: 'profile_incomplete',
    text: `GrowwMatics: your monthly Google Business Profile report for ${name} is ready to start — please add your business category in your dashboard profile so we can generate it.`,
  }).catch(() => {});
}
