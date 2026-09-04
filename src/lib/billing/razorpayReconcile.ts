import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { getRazorpay } from './razorpay';
import { activatePlan, activateBusinessPlan } from './applyEntitlements';
import { isPaidPlanType } from './planCatalog';

/**
 * Self-heals a workspace's activation state by checking DIRECTLY with
 * Razorpay, instead of only ever waiting passively for their webhook.
 *
 * Why this exists: the webhook (app/api/webhook/razorpay/route.ts) is the
 * only place that used to flip entitlements. That's correct as the primary
 * path, but it has a single point of failure with no recovery — if the
 * webhook is ever late, dropped, or (in local dev) physically unreachable
 * because Razorpay's servers can't call `localhost`, a customer who has
 * genuinely paid stays locked out indefinitely. useRazorpayCheckout's
 * client poll would eventually give up with "activation is taking longer
 * than expected" and nothing would ever retry after that.
 *
 * This function is called from GET /api/billing/status — i.e. on every
 * read of "is this workspace unlocked", which already happens on checkout
 * polling, every dashboard nav (Sidebar/WorkspaceLockGate), and the billing
 * page. So the very same signal that used to just report a stuck state now
 * also tries to fix it, with no client-side changes needed.
 *
 * Safe to call often: short-circuits immediately unless the workspace has a
 * linked Razorpay subscription and isn't active yet, is throttled per
 * business, and its writes (activatePlan/activateBusinessPlan) are
 * idempotent upserts — so a real webhook landing moments later is a no-op.
 */

export interface ReconcileResult {
  attempted: boolean;
  activated: boolean;
  razorpayStatus?: string;
  reason?: string;
}

// In-memory per-instance throttle — several components on one page load
// (Sidebar fires two effects, WorkspaceLockGate one more) can all call
// /api/billing/status within the same tick; this keeps that burst to a
// single Razorpay API call instead of three. Not durable across instances/
// cold starts — that's fine, it's a courtesy limit, not a correctness one.
const lastAttempt = new Map<string, number>();
const THROTTLE_MS = 20_000;

export async function reconcileWorkspaceSubscription(businessId: string): Promise<ReconcileResult> {
  const last = lastAttempt.get(businessId);
  if (last && Date.now() - last < THROTTLE_MS) {
    return { attempted: false, activated: false, reason: 'throttled' };
  }

  await dbConnect();
  const business = await Business.findById(businessId)
    .select('subscriptionStatus razorpaySubscriptionId userId')
    .lean() as any;
  if (!business) return { attempted: false, activated: false, reason: 'business not found' };
  if (business.subscriptionStatus === 'active') return { attempted: false, activated: false, reason: 'already active' };
  if (!business.razorpaySubscriptionId) return { attempted: false, activated: false, reason: 'no subscription linked yet' };

  const razorpay = getRazorpay();
  if (!razorpay) return { attempted: false, activated: false, reason: 'billing not configured' };

  lastAttempt.set(businessId, Date.now());

  let sub;
  try {
    sub = await razorpay.subscriptions.fetch(business.razorpaySubscriptionId);
  } catch (err: any) {
    console.error('[billing] reconcile: Razorpay fetch failed for', business.razorpaySubscriptionId, err?.message);
    return { attempted: true, activated: false, reason: 'razorpay fetch failed' };
  }

  // 'active' covers a subscription mid-cycle; paid_count > 0 catches the
  // narrow window where the first charge succeeded but Razorpay hasn't
  // flipped status to 'active' yet — same signal the webhook's
  // subscription.charged event represents.
  const isPaid = sub.status === 'active' || (sub.paid_count ?? 0) > 0;
  if (!isPaid) return { attempted: true, activated: false, razorpayStatus: sub.status };

  const userId = (sub.notes?.userId as string | undefined) || business.userId?.toString();
  const planType = sub.notes?.planType as string | undefined;
  if (!userId || !isPaidPlanType(planType)) {
    console.error(`[billing] reconcile: cannot resolve user/plan for Razorpay subscription ${sub.id}`);
    return { attempted: true, activated: false, razorpayStatus: sub.status, reason: 'cannot resolve user/plan' };
  }

  const currentPeriodEnd = typeof sub.current_end === 'number' ? new Date(sub.current_end * 1000) : undefined;
  await activatePlan(userId, { razorpaySubscriptionId: sub.id, currentPeriodEnd });
  await activateBusinessPlan(businessId, { currentPeriodEnd, eventType: 'subscription.activated' });

  // Same idempotent post-activation sequence the webhook runs (welcome
  // message, ownership transition, …) — every step is individually gated
  // on its own persisted flag, so this is a no-op if the webhook already
  // ran it, and vice versa. Best-effort: never blocks the activation above.
  try {
    const { runCustomerActivationSequence } = await import('@/services/billing/customerActivation');
    await runCustomerActivationSequence(userId, businessId, {});
  } catch (err) {
    console.error('[billing] reconcile: customerActivation sequence failed', err);
  }

  console.warn(
    `[billing] Self-healed subscription ${sub.id} for business ${businessId} — ` +
    `Razorpay reports "${sub.status}" but our webhook hadn't recorded it yet.`
  );
  return { attempted: true, activated: true, razorpayStatus: sub.status };
}
