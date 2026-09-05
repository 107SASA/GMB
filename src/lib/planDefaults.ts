/**
 * Default usage limits per subscription plan.
 * These are used as fallback when no per-user override exists.
 * Update these when final plan tiers are decided.
 */
/** Billing/quota frequency a post limit resets on. Additive — defaults to
 *  'monthly' everywhere so existing plans/overrides behave exactly as before
 *  until a super admin explicitly switches a plan to weekly. New frequencies
 *  (e.g. 'daily') can be added here later without touching every call site,
 *  as long as the corresponding usage-window logic is added in
 *  featureGating.ts's checkUsageLimit(). */
export type PostLimitFrequency = 'monthly' | 'weekly';

export interface PlanLimits {
  maxAuditsPerBusiness:      number;
  maxPostsPerMonth:          number;
  /** How often maxPostsPerMonth resets — despite the field's name (kept for
   *  backward compatibility), it's the post cap for whichever frequency this
   *  is set to, e.g. postLimitFrequency: 'weekly' + maxPostsPerMonth: 4 means
   *  "4 posts per week". */
  postLimitFrequency:        PostLimitFrequency;
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
    // One audit per business per calendar month (owner's explicit call,
    // Sep 2026) — checkUsageLimit's 'audits' case already buckets usage by
    // month (SubscriptionUsage keyed on {businessId, month}), so this is
    // purely a cap-value change, no new machinery needed. Note: an
    // unsubscribed workspace is additionally gated by the STRICTER,
    // lifetime (not monthly) Business.freeAuditUsed check in
    // /api/audit/route.ts, so this value rarely even gets exercised for
    // Free — kept in sync with Pro anyway for consistency.
    maxAuditsPerBusiness:      1,
    maxPostsPerMonth:          10,
    postLimitFrequency:        'monthly',
    maxWhatsAppMessagesPerDay: 50,
    reviewRequestCooldownDays: 30,
    maxAIGenerations:          20,
  },
  Pro: {
    maxAuditsPerBusiness:      1,
    maxPostsPerMonth:          50,
    postLimitFrequency:        'monthly',
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
  override: Partial<Record<keyof PlanLimits, number | string | null>>
): PlanLimits & { overriddenFields: (keyof PlanLimits)[] } {
  const defaults = getPlanDefaults(plan);
  const keys = Object.keys(defaults) as (keyof PlanLimits)[];
  const overriddenFields: (keyof PlanLimits)[] = [];

  const resolved = { ...defaults } as PlanLimits;
  for (const key of keys) {
    // postLimitFrequency is a plan-level policy, not a per-user override —
    // UserLimitOverride never carries it, so it always falls through to the
    // plan's default/configured frequency here.
    if (key === 'postLimitFrequency') continue;
    const val = override[key];
    if (val !== null && val !== undefined) {
      (resolved as any)[key] = val;
      overriddenFields.push(key);
    }
  }

  return { ...resolved, overriddenFields };
}
