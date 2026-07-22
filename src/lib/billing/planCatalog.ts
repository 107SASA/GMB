import dbConnect from '@/lib/mongodb';
import BillingPlan from '@/models/BillingPlan';
import { getRazorpay } from './razorpay';
import type { ModuleKey } from '@/models/Subscription';

/**
 * THE single source of truth for the one sellable plan. There is exactly one
 * paid plan — it unlocks every module (website + mobile app). The super admin
 * edits its price/name/copy via /api/admin/billing-plan, which is stored in
 * the BillingPlan singleton; everything here falls back to PLAN_FALLBACK
 * until that document exists.
 *
 * Internally the paid plan keeps the legacy planType 'Pro' so the
 * Subscription enum, User.subscriptionPlan gating (featureGating.ts /
 * PlanConfig) and the mobile app contract stay unchanged. 'Enterprise' is a
 * legacy value that may still exist on old subscriptions/webhooks — it is
 * treated as paid but can no longer be purchased.
 */

export type SellablePlanType = 'Pro';
export const PAID_PLAN_TYPE: SellablePlanType = 'Pro';

/** Paid plan types we may still see on old subscriptions/webhook notes. */
export function isPaidPlanType(planType: unknown): boolean {
  return planType === 'Pro' || planType === 'Enterprise';
}

export const ALL_MODULES: ModuleKey[] = [
  'google_ranking_agent',
  'reputation_agent',
  'sales_agent',
  'content_studio',
  'marketing_automation',
];

/**
 * Modules that stay enabled with no paid plan — matches the Subscription
 * schema defaults (google_ranking_agent defaults to enabled, all others to
 * disabled). Applied on cancel/expiry.
 */
export const DEFAULT_FREE_MODULES: ModuleKey[] = ['google_ranking_agent'];

/** Defaults used until the super admin saves the BillingPlan document. */
export const PLAN_FALLBACK = {
  displayName: 'Growwmatic AI',
  description:
    'One plan, everything included — GBP optimization, reviews, AI sales agent, content and marketing automation, on web and mobile.',
  priceInr: 1999,
} as const;

export interface ActivePlan {
  planType: SellablePlanType;
  displayName: string;
  description: string;
  /** Price per billing cycle in INR (whole rupees). */
  priceInr: number;
  billingCycle: 'monthly';
  modules: ModuleKey[];
  /** Razorpay Plan id valid for the CURRENT price, or null if one must be created. */
  razorpayPlanId: string | null;
}

function toActivePlan(doc: any): ActivePlan {
  const priceInr = doc?.priceInr ?? PLAN_FALLBACK.priceInr;

  // A stored Razorpay plan id is only usable if it was created for the
  // current price (Razorpay plan amounts are immutable). With no DB doc at
  // all, fall back to the env-provisioned plan id.
  let razorpayPlanId: string | null = null;
  if (doc) {
    if (doc.razorpayPlanId && doc.razorpayPlanPriceInr === priceInr) {
      razorpayPlanId = doc.razorpayPlanId;
    }
  } else {
    razorpayPlanId = process.env.RAZORPAY_PLAN_ID_PRO ?? null;
  }

  return {
    planType: PAID_PLAN_TYPE,
    displayName: doc?.displayName ?? PLAN_FALLBACK.displayName,
    description: doc?.description ?? PLAN_FALLBACK.description,
    priceInr,
    billingCycle: 'monthly',
    modules: ALL_MODULES,
    razorpayPlanId,
  };
}

/** The one sellable plan, with super-admin overrides applied. */
export async function getActivePlan(): Promise<ActivePlan> {
  await dbConnect();
  const doc = await BillingPlan.findOne({ key: 'default' }).lean();
  return toActivePlan(doc);
}

/**
 * Returns the active plan with a Razorpay plan id that matches its current
 * price, creating one via the Razorpay API when needed (price was edited, or
 * nothing is provisioned yet). Returns razorpayPlanId: null when Razorpay
 * isn't configured — callers answer 503 in that case.
 */
export async function ensureRazorpayPlanId(): Promise<ActivePlan> {
  const plan = await getActivePlan();
  if (plan.razorpayPlanId) return plan;

  const razorpay = getRazorpay();
  if (!razorpay) return plan;

  const rpPlan = await razorpay.plans.create({
    period: 'monthly',
    interval: 1,
    item: {
      name: plan.displayName,
      amount: plan.priceInr * 100, // paise
      currency: 'INR',
      description: plan.description || undefined,
    },
  });

  await BillingPlan.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        razorpayPlanId: rpPlan.id,
        razorpayPlanPriceInr: plan.priceInr,
      },
      $setOnInsert: {
        displayName: plan.displayName,
        description: plan.description,
        priceInr: plan.priceInr,
      },
    },
    { upsert: true }
  );

  return { ...plan, razorpayPlanId: rpPlan.id };
}

/**
 * Builds the full Subscription.modules map for a set of enabled modules:
 * listed modules on (stamped now), everything else off.
 */
export function buildModulesMap(
  enabled: ModuleKey[]
): Record<ModuleKey, { enabled: boolean; activatedAt: Date | null }> {
  const now = new Date();
  return Object.fromEntries(
    ALL_MODULES.map((key) => [
      key,
      enabled.includes(key) ? { enabled: true, activatedAt: now } : { enabled: false, activatedAt: null },
    ])
  ) as Record<ModuleKey, { enabled: boolean; activatedAt: Date | null }>;
}

/** Plan shape safe to return from the public /api/billing/plans route. */
export async function publicCatalog() {
  const plan = await getActivePlan();
  return {
    planType: plan.planType,
    displayName: plan.displayName,
    description: plan.description,
    priceInr: plan.priceInr,
    billingCycle: plan.billingCycle,
    modules: plan.modules,
    available: Boolean(process.env.RAZORPAY_KEY_ID),
  };
}
