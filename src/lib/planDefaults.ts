/**
 * Default usage limits per subscription plan.
 * These are used as fallback when no per-user override exists.
 * Update these when final plan tiers are decided.
 */
export interface PlanLimits {
  maxAuditsPerBusiness:      number;
  maxPostsPerMonth:          number;
  maxWhatsAppMessagesPerDay: number;
  reviewRequestCooldownDays: number;
  maxAIGenerations:          number;
}

/**
 * Single-plan model: 'Free' covers trial/unpaid users, 'Pro' is THE paid
 * plan (see lib/billing/planCatalog.ts). Legacy 'Enterprise' subscriptions
 * resolve to Pro limits below.
 */
export const PLAN_DEFAULTS: Record<string, PlanLimits> = {
  Free: {
    maxAuditsPerBusiness:      2,
    maxPostsPerMonth:          10,
    maxWhatsAppMessagesPerDay: 50,
    reviewRequestCooldownDays: 30,
    maxAIGenerations:          20,
  },
  Pro: {
    maxAuditsPerBusiness:      10,
    maxPostsPerMonth:          50,
    maxWhatsAppMessagesPerDay: 200,
    reviewRequestCooldownDays: 14,
    maxAIGenerations:          100,
  },
};

export const FALLBACK_LIMITS: PlanLimits = PLAN_DEFAULTS.Free;

export function getPlanDefaults(plan: string): PlanLimits {
  if (plan === 'Enterprise') plan = 'Pro'; // legacy paid tier
  return PLAN_DEFAULTS[plan] ?? FALLBACK_LIMITS;
}

/**
 * Merge: user override wins where set (non-null); falls back to plan defaults.
 */
export function resolveEffectiveLimits(
  plan: string,
  override: Partial<Record<keyof PlanLimits, number | null>>
): PlanLimits & { overriddenFields: (keyof PlanLimits)[] } {
  const defaults = getPlanDefaults(plan);
  const keys = Object.keys(defaults) as (keyof PlanLimits)[];
  const overriddenFields: (keyof PlanLimits)[] = [];

  const resolved = { ...defaults } as PlanLimits;
  for (const key of keys) {
    const val = override[key];
    if (val !== null && val !== undefined) {
      (resolved as any)[key] = val;
      overriddenFields.push(key);
    }
  }

  return { ...resolved, overriddenFields };
}
