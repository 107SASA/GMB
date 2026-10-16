import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { getRazorpay } from './razorpay';
import { impliedEventFromState, subscriptionFactsFrom } from './subscriptionMachine';
import { applyRazorpayEvent } from '@/services/billing/billingEvents';

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
 * linked Razorpay subscription and isn't active yet (or is a trial whose first
 * charge is due), and is throttled per business. Razorpay's current state is
 * applied through services/billing/billingEvents.ts — the SAME rules as the
 * webhook (a trial is never paid without a verified charge; a declined or
 * expired checkout never fails or cancels anyone) — so a real webhook landing
 * moments later is a no-op.
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

export async function reconcileWorkspaceSubscription(
  businessId: string,
  /** force: skip the throttle; subscriptionId: check this subscription (safe recovery found it paid). */
  opts: { force?: boolean; subscriptionId?: string } = {}
): Promise<ReconcileResult> {
  const last = lastAttempt.get(businessId);
  if (!opts.force && last && Date.now() - last < THROTTLE_MS) {
    return { attempted: false, activated: false, reason: 'throttled' };
  }

  await dbConnect();
  const business = await Business.findById(businessId)
    .select('subscriptionStatus razorpaySubscriptionId billingSubscriptionId trialEndsAt')
    .lean() as any;
  if (!business) return { attempted: false, activated: false, reason: 'business not found' };
  if (business.subscriptionStatus === 'active') return { attempted: false, activated: false, reason: 'already active' };
  // A running trial has nothing to heal until its first charge is due.
  if (
    business.subscriptionStatus === 'trial_active' &&
    business.trialEndsAt &&
    new Date(business.trialEndsAt).getTime() > Date.now()
  ) {
    return { attempted: false, activated: false, reason: 'trial in progress' };
  }
  const subscriptionId = opts.subscriptionId || business.billingSubscriptionId || business.razorpaySubscriptionId;
  if (!subscriptionId) return { attempted: false, activated: false, reason: 'no subscription linked yet' };

  const razorpay = getRazorpay();
  if (!razorpay) return { attempted: false, activated: false, reason: 'billing not configured' };

  lastAttempt.set(businessId, Date.now());

  let sub: any;
  try {
    sub = await razorpay.subscriptions.fetch(subscriptionId);
  } catch (err: any) {
    console.error('[billing] reconcile: Razorpay fetch failed for', subscriptionId, err?.message);
    return { attempted: true, activated: false, reason: 'razorpay fetch failed' };
  }

  const facts = subscriptionFactsFrom(sub);
  const implied = facts ? impliedEventFromState(facts) : null;
  if (!facts || !implied) return { attempted: true, activated: false, razorpayStatus: sub?.status };

  // A trial's first charge must be proven by the paid invoice's amount — the
  // same check the webhook makes on the payment entity. Non-trial
  // subscriptions keep the previous behaviour (paid_count > 0 is enough).
  let paymentEntity: any = null;
  if (implied === 'subscription.charged' && facts.isTrial) {
    try {
      const invoices: any = await (razorpay as any).invoices.all({ subscription_id: subscriptionId });
      const paid = (invoices?.items ?? []).find((inv: any) => inv.status === 'paid');
      if (paid) paymentEntity = { id: paid.payment_id, amount: paid.amount_paid, currency: paid.currency, status: 'captured' };
    } catch (err: any) {
      console.error('[billing] reconcile: invoice fetch failed for', subscriptionId, err?.message);
    }
    if (!paymentEntity) return { attempted: true, activated: false, razorpayStatus: sub.status, reason: 'trial charge not verifiable yet' };
  }

  const before = business.subscriptionStatus;
  await applyRazorpayEvent({
    type: implied,
    eventAt: new Date(),
    subEntity: sub,
    paymentEntity,
    source: 'reconcile',
  });
  const after = await Business.findById(businessId).select('subscriptionStatus').lean() as any;
  const activated = after?.subscriptionStatus === 'active' && before !== 'active';
  if (after?.subscriptionStatus !== before) {
    console.warn(
      `[billing] Self-healed subscription ${sub.id} for business ${businessId}: ` +
      `${before} → ${after?.subscriptionStatus} (Razorpay "${sub.status}", webhook not yet recorded).`
    );
  }
  return { attempted: true, activated, razorpayStatus: sub.status };
}
