import type { ModuleKey } from '@/models/Subscription';

/**
 * THE single source of truth for what each sellable plan costs and which
 * modules it enables. Nothing else may hardcode plan→module logic — the
 * checkout route, the webhook, the pricing page and the billing UI all read
 * this catalog.
 *
 * Plan names align with the existing Subscription.planType enum
 * ('Free' | 'Pro' | 'Enterprise') and the PLAN_DEFAULTS / PlanConfig names
 * that featureGating.ts uses for usage limits — do not invent new names.
 */

export type SellablePlanType = 'Pro' | 'Enterprise';

export interface SellablePlan {
  planType: SellablePlanType;
  displayName: string;
  description: string;
  /** Price per billing cycle in INR (whole rupees, shown on the pricing page). */
  priceInr: number;
  billingCycle: 'monthly';
  /** Modules this plan switches on (everything else gets switched off). */
  modules: ModuleKey[];
  /**
   * The Razorpay Plan id (plan_...) created in the Razorpay dashboard for
   * this tier. Comes from env so test/live modes can differ; when missing,
   * checkout for this plan is disabled.
   */
  razorpayPlanId: string | undefined;
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

export const PLAN_CATALOG: Record<SellablePlanType, SellablePlan> = {
  Pro: {
    planType: 'Pro',
    displayName: 'Pro',
    description: 'Rank higher and own your reputation — GBP optimization, reviews and AI content.',
    priceInr: 1999,
    billingCycle: 'monthly',
    modules: ['google_ranking_agent', 'reputation_agent', 'content_studio'],
    razorpayPlanId: process.env.RAZORPAY_PLAN_ID_PRO,
  },
  Enterprise: {
    planType: 'Enterprise',
    displayName: 'Enterprise',
    description: 'The full suite — everything in Pro plus the AI sales agent and marketing automation.',
    priceInr: 4999,
    billingCycle: 'monthly',
    modules: [
      'google_ranking_agent',
      'reputation_agent',
      'sales_agent',
      'content_studio',
      'marketing_automation',
    ],
    razorpayPlanId: process.env.RAZORPAY_PLAN_ID_ENTERPRISE,
  },
};

export function getSellablePlan(planType: string): SellablePlan | null {
  return planType === 'Pro' || planType === 'Enterprise' ? PLAN_CATALOG[planType] : null;
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

/** Catalog shape safe to return from the public /api/billing/plans route. */
export function publicCatalog() {
  return (Object.values(PLAN_CATALOG) as SellablePlan[]).map((p) => ({
    planType: p.planType,
    displayName: p.displayName,
    description: p.description,
    priceInr: p.priceInr,
    billingCycle: p.billingCycle,
    modules: p.modules,
    available: Boolean(p.razorpayPlanId && process.env.RAZORPAY_KEY_ID),
  }));
}
