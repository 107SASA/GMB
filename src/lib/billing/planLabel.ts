/**
 * Customer-facing labels for the internal plan types.
 *
 * Client-safe on purpose: no mongoose/dbConnect imports, so this can be used
 * from 'use client' components. Do NOT import planCatalog.ts here.
 *
 * The internal planType stays 'Pro' for DB/enum/mobile-contract compatibility
 * (see planCatalog.ts), and 'Enterprise' still exists on legacy subscriptions.
 * Neither is a real, purchasable tier any more — there is exactly one plan —
 * so neither string should ever be shown to a customer.
 */

export const FREE_PLAN_LABEL = 'Free';

/**
 * @param planType  internal value: 'Free' | 'Pro' | 'Enterprise' | undefined
 * @param planName  the live plan displayName from /api/billing/plans, if loaded
 */
export function planDisplayLabel(
  planType: string | null | undefined,
  planName?: string | null
): string {
  if (!planType || planType === 'Free') return FREE_PLAN_LABEL;
  // Every paid plan — current or legacy — presents as the one sellable plan.
  return planName?.trim() || 'GrowwMatics AI';
}

/** True for any paid plan, including the legacy 'Enterprise' value. */
export function isPaidPlanLabel(planType: string | null | undefined): boolean {
  return planType === 'Pro' || planType === 'Enterprise';
}
