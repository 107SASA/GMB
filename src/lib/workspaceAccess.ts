/**
 * Single source of truth for "is this workspace unlocked?" — used by the
 * central gate (src/proxy.ts) and the billing status API so they never drift.
 *
 * A workspace is unlocked when EITHER:
 *   1. the workspace itself has an active subscription
 *      (Business.subscriptionStatus === 'active'), the per-workspace signal set
 *      by the Razorpay webhook; OR
 *   2. the owning user has an active paid plan (User.subscriptionPlan !== 'Free').
 *      This fallback covers subscribers from BEFORE per-workspace billing
 *      existed, and any case where the webhook flipped the user plan but not
 *      (yet) the workspace — so a paying customer is never locked out.
 *
 * Pure function (no DB) so it's safe to call from the Node middleware runtime.
 */
export function isWorkspaceUnlocked(opts: {
  subscriptionStatus?: string | null;
  userSubscriptionPlan?: string | null;
}): boolean {
  if (opts.subscriptionStatus === 'active') return true;
  const plan = opts.userSubscriptionPlan;
  return !!plan && plan !== 'Free';
}
