import { NextResponse } from 'next/server';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';
import { PLAN_ACCESS_FIELDS, workspaceAccessState } from '@/lib/billing/entitlements';
import { PAID_MODULE_KEYS } from '@/lib/billing/billingPolicy';

/**
 * Per-WORKSPACE paid access for API routes — the server half of the
 * dashboard lock in proxy.ts (each workspace needs its own subscription).
 *
 * Why this exists: API routes only checked the user (requireModule reads the
 * user's single Subscription), and ~70 workspace routes checked nothing at
 * all. So an unpaid workspace — a free signup, or a second workspace of a
 * customer who paid for one — could use paid features by calling the API
 * directly (the page lock is only UI).
 *
 * Allowed when:
 *  - the caller is a super admin (support, "Login as customer"), or the
 *    workspace owner is one;
 *  - isWorkspaceUnlocked (same as the page lock: active, trial, payment
 *    grace, legacy pre-July workspace on a paid user plan);
 *  - payment failed and grace ended, but the frozen policy restricts only
 *    SOME modules: the module is not one of them (or, when the route does
 *    not name a module, at least one paid module is still open — those
 *    routes had no check at all before, so this never locks more than the
 *    page lock does).
 *
 * Responds with the same 403 { error: 'MODULE_LOCKED' } shape the web and
 * mobile clients already handle (mobile re-checks entitlements on it).
 */
export async function requireWorkspacePlan(
  userId: string,
  businessId: string,
  module?: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  // Loaded on first use, so routes stay importable without a database (tests).
  const [{ default: dbConnect }, { default: User }, { default: Business }] = await Promise.all([
    import('@/lib/mongodb'),
    import('@/models/User'),
    import('@/models/Business'),
  ]);
  await dbConnect();
  const caller = await User.findById(userId).select('role').lean<{ role?: string }>();
  if (caller?.role === 'SUPER_ADMIN') return { ok: true };

  const b = await Business.findOne({ _id: businessId, isDeleted: { $ne: true } })
    .select(`userId createdAt ${PLAN_ACCESS_FIELDS}`)
    .lean<any>();
  if (b) {
    const owner = b.userId ? await User.findById(b.userId).select('role subscriptionPlan').lean<any>() : null;
    if (owner?.role === 'SUPER_ADMIN') return { ok: true };
    if (
      isWorkspaceUnlocked({
        subscriptionStatus: b.subscriptionStatus,
        userSubscriptionPlan: owner?.subscriptionPlan,
        businessCreatedAt: b.createdAt,
        trialEndsAt: b.trialEndsAt,
        trialCancelledAt: b.trialCancelledAt,
        paymentGraceEndsAt: b.paymentGraceEndsAt,
        paymentAccessHold: b.paymentAccessHold,
      })
    ) {
      return { ok: true };
    }
    const state = workspaceAccessState(b);
    if (state.mode === 'restricted' && state.restrictedModules) {
      const open = module
        ? !state.restrictedModules.includes(module)
        : state.restrictedModules.length < PAID_MODULE_KEYS.length;
      if (open) return { ok: true };
    }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: 'MODULE_LOCKED', code: 'WORKSPACE_LOCKED', ...(module ? { module } : {}), message: 'This workspace needs an active plan to use this feature.' },
      { status: 403 }
    ),
  };
}
