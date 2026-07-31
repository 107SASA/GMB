// Per-workspace billing went live on this date (see src/proxy.ts's matching
// INTAKE_ENFORCED_SINCE, rolled out the same day). Businesses created before
// it never got `subscriptionStatus: 'active'` backfilled onto them, so they
// rely on the user-level fallback below. Anything created on/after it must
// carry its own active subscription — it must NOT inherit access just
// because the same owner has another paid workspace.
export const PER_WORKSPACE_BILLING_ENFORCED_SINCE = new Date('2026-07-23T00:00:00.000Z');

/**
 * Single source of truth for "is this workspace unlocked?" — used by the
 * central gate (src/proxy.ts) and the billing status API so they never drift.
 *
 * A workspace is unlocked when EITHER:
 *   1. the workspace itself has an active subscription
 *      (Business.subscriptionStatus === 'active'), the per-workspace signal set
 *      by the Razorpay webhook; OR
 *   2. it's a LEGACY workspace (created before per-workspace billing existed)
 *      AND the owning user has an active paid plan (User.subscriptionPlan !==
 *      'Free'). This grandfathers in subscribers from before the per-workspace
 *      gate, whose Business docs never got `subscriptionStatus` backfilled.
 *      Workspaces created since do NOT get this fallback — each one needs its
 *      own subscription, by design (see models/Business.ts).
 *
 * Pure function (no DB) so it's safe to call from the Node middleware runtime.
 */
export function isWorkspaceUnlocked(opts: {
  subscriptionStatus?: string | null;
  userSubscriptionPlan?: string | null;
  /** Business.createdAt — omit only for legacy call sites; missing/unknown is
   *  treated as "may be legacy" so a caller that hasn't been updated yet fails
   *  open rather than locking out an existing paying customer. */
  businessCreatedAt?: Date | string | null;
}): boolean {
  if (opts.subscriptionStatus === 'active') return true;

  const createdAt = opts.businessCreatedAt ? new Date(opts.businessCreatedAt) : null;
  const isLegacyWorkspace = !createdAt || createdAt < PER_WORKSPACE_BILLING_ENFORCED_SINCE;
  if (!isLegacyWorkspace) return false;

  const plan = opts.userSubscriptionPlan;
  return !!plan && plan !== 'Free';
}
