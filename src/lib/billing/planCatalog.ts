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

// ── Billing durations ──────────────────────────────────────────────────────
export type BillingCycle = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

export interface CycleMeta {
  label: string;
  months: number;
  razorpayPeriod: 'monthly' | 'yearly';
  razorpayInterval: number;
  /** How many billing cycles Razorpay attempts before the subscription ends. */
  totalCount: number;
}

export const CYCLES: Record<BillingCycle, CycleMeta> = {
  monthly:    { label: 'Monthly',   months: 1,  razorpayPeriod: 'monthly', razorpayInterval: 1, totalCount: 12 },
  quarterly:  { label: 'Quarterly', months: 3,  razorpayPeriod: 'monthly', razorpayInterval: 3, totalCount: 8 },
  halfyearly: { label: '6 Months',  months: 6,  razorpayPeriod: 'monthly', razorpayInterval: 6, totalCount: 6 },
  yearly:     { label: 'Yearly',    months: 12, razorpayPeriod: 'yearly',  razorpayInterval: 1, totalCount: 5 },
};

export const CYCLE_ORDER: BillingCycle[] = ['monthly', 'quarterly', 'halfyearly', 'yearly'];

export function isBillingCycle(v: unknown): v is BillingCycle {
  return typeof v === 'string' && (CYCLE_ORDER as string[]).includes(v);
}

export const DEFAULT_FEATURES: string[] = [
  'Google Ranking Agent — GBP optimization & audits',
  'Reputation Agent — reviews & AI replies',
  'Content Studio — AI posts & SEO content',
  'Marketing Automation — campaigns & CRM',
  'Full access on web and mobile app',
];

/**
 * Modules that stay enabled with no paid plan — matches the Subscription
 * schema defaults (google_ranking_agent defaults to enabled, all others to
 * disabled). Applied on cancel/expiry.
 */
export const DEFAULT_FREE_MODULES: ModuleKey[] = ['google_ranking_agent'];

/** Defaults used until the super admin saves the BillingPlan document. */
export const PLAN_FALLBACK = {
  displayName: 'GrowwMatics AI',
  description:
    'One plan, everything included — GBP optimization, reviews, AI sales agent, content and marketing automation, on web and mobile.',
  priceInr: 1999,
} as const;

export interface PlanDurationView {
  cycle: BillingCycle;
  label: string;
  months: number;
  priceInr: number;
  enabled: boolean;
  /** Razorpay Plan id valid for this cycle's CURRENT price, or null. */
  razorpayPlanId: string | null;
}

export interface ActivePlan {
  planType: SellablePlanType;
  displayName: string;
  description: string;
  features: string[];
  /** Monthly price (back-compat convenience). */
  priceInr: number;
  billingCycle: 'monthly';
  modules: ModuleKey[];
  /** All four durations, with per-cycle price/enabled/razorpay id. */
  durations: PlanDurationView[];
  /** Monthly Razorpay Plan id valid for the current monthly price, or null. */
  razorpayPlanId: string | null;
}

/** Builds the four duration views, preferring stored durations, else synthesizing. */
function buildDurations(doc: any, base: number): PlanDurationView[] {
  const stored = new Map<string, any>((doc?.durations ?? []).map((d: any) => [d.cycle, d]));
  return CYCLE_ORDER.map((cycle) => {
    const meta = CYCLES[cycle];
    const s = stored.get(cycle);
    if (s) {
      // A stored Razorpay id is only usable if created for the current price.
      const rp = s.razorpayPlanId && s.razorpayPlanPriceInr === s.priceInr ? s.razorpayPlanId : null;
      return { cycle, label: meta.label, months: meta.months, priceInr: s.priceInr, enabled: !!s.enabled, razorpayPlanId: rp };
    }
    // No stored duration: monthly falls back to the legacy fields; others are
    // disabled at a sensible default (base × months) until the admin sets them.
    if (cycle === 'monthly') {
      const rp = doc
        ? (doc.razorpayPlanId && doc.razorpayPlanPriceInr === base ? doc.razorpayPlanId : null)
        : (process.env.RAZORPAY_PLAN_ID_PRO ?? null);
      return { cycle, label: meta.label, months: 1, priceInr: base, enabled: true, razorpayPlanId: rp };
    }
    return { cycle, label: meta.label, months: meta.months, priceInr: base * meta.months, enabled: false, razorpayPlanId: null };
  });
}

function toActivePlan(doc: any): ActivePlan {
  const priceInr = doc?.priceInr ?? PLAN_FALLBACK.priceInr;
  const durations = buildDurations(doc, priceInr);
  const monthly = durations.find((d) => d.cycle === 'monthly')!;

  return {
    planType: PAID_PLAN_TYPE,
    displayName: doc?.displayName ?? PLAN_FALLBACK.displayName,
    description: doc?.description ?? PLAN_FALLBACK.description,
    features: doc?.features?.length ? doc.features : DEFAULT_FEATURES,
    priceInr,
    billingCycle: 'monthly',
    modules: ALL_MODULES,
    durations,
    razorpayPlanId: monthly.razorpayPlanId,
  };
}

/** The one sellable plan, with super-admin overrides applied. */
export async function getActivePlan(): Promise<ActivePlan> {
  await dbConnect();
  const doc = await BillingPlan.findOne({ key: 'default' }).lean();
  return toActivePlan(doc);
}

/**
 * Ensures the given duration has a Razorpay plan id matching its current price,
 * creating one via the Razorpay API when needed. Persists the full durations
 * array on first use so per-cycle Razorpay ids have somewhere to live.
 * Returns razorpayPlanId: null when Razorpay isn't configured (caller answers 503).
 */
export async function ensureRazorpayPlanIdForCycle(cycle: BillingCycle): Promise<PlanDurationView> {
  const plan = await getActivePlan();
  const dur = plan.durations.find((d) => d.cycle === cycle);
  if (!dur) throw new Error(`Unknown billing cycle: ${cycle}`);
  if (!dur.enabled) throw new Error('That billing duration is not available.');
  if (dur.razorpayPlanId) return dur;

  const razorpay = getRazorpay();
  if (!razorpay) return dur; // caller answers 503

  const meta = CYCLES[cycle];
  const rpPlan = await razorpay.plans.create({
    period: meta.razorpayPeriod,
    interval: meta.razorpayInterval,
    item: {
      name: `${plan.displayName} (${meta.label})`,
      amount: dur.priceInr * 100, // paise
      currency: 'INR',
      description: plan.description || undefined,
    },
  });

  // Persist the full durations array (so every cycle has a slot), then stamp
  // this cycle's Razorpay id/price.
  const durationsToStore = plan.durations.map((d) => ({
    cycle: d.cycle,
    priceInr: d.priceInr,
    enabled: d.enabled,
    razorpayPlanId: d.cycle === cycle ? rpPlan.id : (d.razorpayPlanId ?? undefined),
    razorpayPlanPriceInr: d.cycle === cycle ? dur.priceInr : (d.razorpayPlanId ? d.priceInr : undefined),
  }));

  await BillingPlan.findOneAndUpdate(
    { key: 'default' },
    {
      $set: { durations: durationsToStore },
      $setOnInsert: {
        displayName: plan.displayName,
        description: plan.description,
        priceInr: plan.priceInr,
        features: plan.features,
      },
    },
    { upsert: true }
  );

  return { ...dur, razorpayPlanId: rpPlan.id };
}

/** Back-compat: ensures the MONTHLY duration's Razorpay plan id. */
export async function ensureRazorpayPlanId(): Promise<ActivePlan> {
  await ensureRazorpayPlanIdForCycle('monthly').catch(() => undefined);
  return getActivePlan();
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
    features: plan.features,
    // Only the enabled durations are offered to customers.
    durations: plan.durations
      .filter((d) => d.enabled)
      .map((d) => ({ cycle: d.cycle, label: d.label, months: d.months, priceInr: d.priceInr })),
    available: Boolean(process.env.RAZORPAY_KEY_ID),
  };
}
