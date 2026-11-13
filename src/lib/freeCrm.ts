import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Lead from '@/models/Lead';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import { PLAN_ACCESS_FIELDS, freeCrmEligible, workspaceAccessState } from '@/lib/billing/entitlements';
import { checkUsageLimit, getPlanLimitsFromDB, resolveUserLimits } from '@/lib/featureGating';

/**
 * Free CRM tier — server side.
 *
 * An unpaid workspace (never paid, cancelled, trial ended) keeps the CRM and
 * visiting-card scan for free within the Free plan's limits, both set by the
 * super admin (Admin → Customers → plan limits / per-customer overrides):
 *   - maxActiveLeads        (Free default 200; 0 turns the free CRM off)
 *   - maxCardScansPerMonth  (Free default 50)
 * Paid workspaces use their plan's limits (Pro: unlimited active leads).
 *
 * "Active lead" = not yet Won or Lost (lifeCycleStage not converted/closed).
 */

const ACTIVE_LEAD_FILTER = { lifeCycleStage: { $nin: ['converted', 'closed'] } };

/** True when this workspace may use the CRM routes for free right now. */
export async function freeCrmAllowed(userId: string, businessId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(businessId)) return false;
  await dbConnect();
  const [sub, business, freeLimits] = await Promise.all([
    Subscription.findOne({ userId }).select('billingStatus accessHold paymentGraceEndsAt').lean<any>(),
    Business.findOne({ _id: businessId, isDeleted: { $ne: true } }).select(PLAN_ACCESS_FIELDS).lean<any>(),
    getPlanLimitsFromDB('Free'),
  ]);
  if (!business || freeLimits.maxActiveLeads === 0) return false;
  return freeCrmEligible(business, sub);
}

/** The active-lead cap that applies to this workspace (its owner's overrides included). */
async function activeLeadLimit(businessId: string): Promise<number> {
  const business = await Business.findById(businessId).select(`userId ${PLAN_ACCESS_FIELDS}`).lean<any>();
  if (!business?.userId) return -1;
  const mode = workspaceAccessState(business).mode;
  // A workspace with plan access (or in its payment-failure window) is on the paid plan.
  const plan = mode === 'none' ? 'Free' : 'Pro';
  const owner = await User.findById(business.userId).select('role').lean<any>();
  if (owner?.role === 'SUPER_ADMIN') return -1;
  return (await resolveUserLimits(business.userId, plan)).maxActiveLeads;
}

export async function countActiveLeads(businessId: string): Promise<number> {
  return Lead.countDocuments({ businessId: new mongoose.Types.ObjectId(businessId), ...ACTIVE_LEAD_FILTER });
}

export interface LeadCapacity {
  allowed: boolean;
  limit: number; // -1 = unlimited
  used: number;
}

/** Can this workspace add one more active lead? Checked before creating a lead (and before a card-scan AI call). */
export async function activeLeadCapacity(businessId: string): Promise<LeadCapacity> {
  await dbConnect();
  const limit = await activeLeadLimit(businessId);
  if (limit < 0) return { allowed: true, limit, used: 0 };
  const used = await countActiveLeads(businessId);
  return { allowed: used < limit, limit, used };
}

export function leadLimitMessage(limit: number): string {
  return `You have ${limit} active leads — the most your plan allows. Mark some as Won or Lost to add more.`;
}

/** Usage shown to a Free-CRM workspace in the app and on the website. */
export async function freeCrmUsage(userId: string, businessId: string) {
  const [cap, scans] = await Promise.all([
    activeLeadCapacity(businessId),
    checkUsageLimit(userId, businessId, 'cardScans'),
  ]);
  const now = new Date();
  return {
    activeLeads: cap.used,
    maxActiveLeads: cap.limit,
    scansUsed: scans.used ?? 0,
    maxScansPerMonth: scans.limit ?? 0,
    // Card-scan usage is counted per calendar month (UTC).
    scansResetAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}
