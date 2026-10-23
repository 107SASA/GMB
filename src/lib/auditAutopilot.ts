import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Audit from '@/models/Audit';
import Organization from '@/models/Organization';
import User from '@/models/User';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { incrementUsage } from '@/lib/featureGating';
import { notifyBusinessUsers } from '@/services/notifications';
import { notifyOwner } from '@/services/ownerNotify';
import { appLink, composeOwnerMessage } from '@/lib/whatsappOutbound';
import { workspaceHasPlanAccess, PLAN_ACCESS_FIELDS } from '@/lib/billing/entitlements';

/** Exact-one-month cadence, matching the old seoPlanMonthlyReaudit cutoff. */
export const AUDIT_AUTOPILOT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** How often at most the "add your business category" nudge is re-sent. */
const CATEGORY_NUDGE_THROTTLE_MS = 3 * 24 * 60 * 60 * 1000;

/** The category nudge reaches WhatsApp at most this many times in total; the in-app notice keeps the 3-day throttle. */
export const CATEGORY_NUDGE_WHATSAPP_LIMIT = 2;

/**
 * Category-nudge WhatsApps already sent. A business nudged before the counter
 * existed (Oct 2026) is counted as having had one.
 */
export function categoryNudgeWhatsAppsSent(business: {
  auditAutopilotCategoryNudgeWhatsApps?: number | null;
  auditAutopilotCategoryNudgedAt?: Date | string | null;
}): number {
  if (typeof business.auditAutopilotCategoryNudgeWhatsApps === 'number') return business.auditAutopilotCategoryNudgeWhatsApps;
  return business.auditAutopilotCategoryNudgedAt ? 1 : 0;
}

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
        `name ${PLAN_ACCESS_FIELDS} googleConnected category userDefinedCategory ` +
          'auditAutopilotNextRunAt auditAutopilotCategoryNudgedAt organizationId userId phone'
      )
      .lean<{
        _id: any;
        name?: string;
        subscriptionStatus?: string;
        trialEndsAt?: Date;
        trialCancelledAt?: Date;
        paymentGraceEndsAt?: Date;
        paymentAccessHold?: boolean;
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
    // Paid, or an authorized free trial (same plan) — see lib/billing/entitlements.ts.
    if (!workspaceHasPlanAccess(business) || !business.googleConnected) return; // not qualified yet

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

    const audit: any = await createPendingAuditAndDispatch(business, org, user, { fastMode: false, trigger });
    // Already has this month's report / its baseline — nothing new was run.
    if (audit?.$locals?.reused) return false;
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
 * landing, can reach here. Nudge in-app (every 3 days) and on WhatsApp (at
 * most CATEGORY_NUDGE_WHATSAPP_LIMIT times in total), and let the hourly cron
 * pick the audit up the moment a category exists.
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

  // Atomic: the hourly cron and the activation hooks can overlap — only the
  // caller that moves the timestamp it read sends this round's nudge.
  const before = await Business.findOneAndUpdate(
    {
      _id: business._id,
      auditAutopilotCategoryNudgedAt: business.auditAutopilotCategoryNudgedAt ? new Date(business.auditAutopilotCategoryNudgedAt) : { $in: [null] },
    },
    { $set: { auditAutopilotCategoryNudgedAt: new Date() } },
    { new: false, projection: { auditAutopilotCategoryNudgedAt: 1, auditAutopilotCategoryNudgeWhatsApps: 1 } }
  ).lean<{ auditAutopilotCategoryNudgedAt?: Date; auditAutopilotCategoryNudgeWhatsApps?: number }>();
  if (!before) return;

  const name = business.name || 'your business';
  await notifyBusinessUsers(business._id.toString(), {
    type: 'profile_incomplete',
    title: 'Add your business category',
    body: `We're ready to generate ${name}'s Google Business Profile report automatically — just add your business category to your profile so we can build it.`,
    link: '/dashboard/onboarding/intake',
  }).catch(() => {});

  // WhatsApp: two sends in total, then in-app only. The count is taken before
  // sending and given back when nothing went out (opted out, no phone, failed).
  const sent = categoryNudgeWhatsAppsSent(before);
  if (sent >= CATEGORY_NUDGE_WHATSAPP_LIMIT) return;
  const counted = await Business.updateOne(
    { _id: business._id, auditAutopilotCategoryNudgeWhatsApps: typeof before.auditAutopilotCategoryNudgeWhatsApps === 'number' ? before.auditAutopilotCategoryNudgeWhatsApps : { $in: [null] } },
    { $set: { auditAutopilotCategoryNudgeWhatsApps: sent + 1 } }
  );
  if (!counted.modifiedCount) return;

  const res = await notifyOwner(business._id.toString(), {
    event: 'profile_incomplete',
    text: composeOwnerMessage({
      name,
      body: 'We are ready to create your Google Business Profile report. Please add your business category so we can generate it.',
      linkLabel: 'Add your category',
      link: appLink('/dashboard/onboarding/intake'),
      noLinkText: 'Add it from your profile in the Growwmatics dashboard.',
    }),
  }).catch(() => null);
  if (res?.status !== 'sent') {
    await Business.updateOne(
      { _id: business._id, auditAutopilotCategoryNudgeWhatsApps: sent + 1 },
      { $set: { auditAutopilotCategoryNudgeWhatsApps: sent } }
    ).catch(() => {});
  }
}
