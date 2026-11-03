import Business from '@/models/Business';
import BillingEvent from '@/models/BillingEvent';
import TrialClaim from '@/models/TrialClaim';
import { getRazorpay, getRazorpayMode } from '@/lib/billing/razorpay';
import { ensureRazorpayPlanIdForCycle, getActivePlan, CYCLES, isBillingCycle, type BillingCycle } from '@/lib/billing/planCatalog';
import { reconcileWorkspaceSubscription } from '@/lib/billing/razorpayReconcile';
import { chooseRecoveryPlan, prepareRecoveryCheckout, type AgreedTrialTerms, type RecoveryResult } from '@/lib/billing/paymentRecovery';

/**
 * The free-trial terms this workspace agreed to, when the subscription being
 * replaced came from that trial: its plan is the trial's frozen plan (also
 * after earlier recoveries, which reuse it), or — plan unknown — the
 * workspace's paying subscription is the trial subscription itself.
 */
export async function agreedTrialTermsForRecovery(businessId: string, replacesPlanId: string | null): Promise<AgreedTrialTerms | null> {
  let filter: Record<string, unknown> | null = null;
  if (replacesPlanId) {
    filter = { businessId, status: 'consumed', 'offer.razorpayPlanId': replacesPlanId };
  } else {
    const ws = await Business.findById(businessId).select('billingSubscriptionId').lean<{ billingSubscriptionId?: string }>();
    if (ws?.billingSubscriptionId) filter = { businessId, status: 'consumed', razorpaySubscriptionId: ws.billingSubscriptionId };
  }
  if (!filter) return null;
  const claim = await TrialClaim.findOne(filter).select('offer').lean<any>();
  if (!claim?.offer?.razorpayPlanId || !claim.offer.amountPaise) return null;
  return { razorpayPlanId: claim.offer.razorpayPlanId, amountPaise: claim.offer.amountPaise, razorpayMode: claim.offer.razorpayMode ?? null };
}

/**
 * Production wiring for the safe recovery checkout (lib/billing/paymentRecovery.ts):
 * real Razorpay calls, and every step recorded in the BillingEvent audit
 * trail (failed / ambiguous operations flagged needsReview for operators).
 */
export async function startRecoveryCheckout(input: { businessId: string; userId: string; cycle: string }): Promise<RecoveryResult> {
  const razorpay = getRazorpay();
  const razorpayMode = getRazorpayMode();
  if (!razorpay || !razorpayMode) return { kind: 'unavailable', reason: 'billing_not_configured' };
  const cycle: BillingCycle = isBillingCycle(input.cycle) ? input.cycle : 'yearly';

  return prepareRecoveryCheckout(
    {
      Business,
      razorpayMode,
      now: () => new Date(),
      fetchSubscription: async (id) => {
        const sub: any = await razorpay.subscriptions.fetch(id);
        return { status: String(sub.status), paidCount: Number(sub.paid_count ?? 0), planId: sub.plan_id ? String(sub.plan_id) : null };
      },
      cancelSubscription: async (id) => {
        await razorpay.subscriptions.cancel(id, false);
      },
      createSubscription: async ({ businessId, userId, replaces, replacesPlanId, expireBy }) => {
        const plan = await getActivePlan();
        // A free-trial customer is recovered on the exact plan (price) they agreed to.
        const choice = chooseRecoveryPlan(await agreedTrialTermsForRecovery(businessId, replacesPlanId), razorpayMode);
        if (choice.kind === 'blocked') throw new Error(choice.reason);
        let planId: string;
        let amountPaise: number;
        let useCycle: BillingCycle;
        if (choice.kind === 'agreed') {
          planId = choice.planId;
          amountPaise = choice.amountPaise;
          useCycle = choice.cycle;
        } else {
          const duration = await ensureRazorpayPlanIdForCycle(cycle);
          if (!duration.razorpayPlanId) throw new Error('billing plan not configured');
          planId = duration.razorpayPlanId;
          amountPaise = duration.priceInr * 100;
          useCycle = cycle;
        }
        const sub: any = await razorpay.subscriptions.create({
          plan_id: planId,
          customer_notify: 1,
          total_count: CYCLES[useCycle].totalCount,
          expire_by: Math.floor(expireBy.getTime() / 1000),
          notes: {
            userId,
            businessId,
            planType: plan.planType,
            billingCycle: useCycle,
            trial: '0',
            recoveryOf: replaces ?? '',
            ...(choice.kind === 'agreed' && { agreedTrialPlan: '1' }),
          },
        } as any);
        return { id: sub.id, planId, amountPaise, cycle: useCycle };
      },
      reconcilePaid: async (businessId, subscriptionId) => {
        await reconcileWorkspaceSubscription(businessId, { force: true, subscriptionId });
      },
      record: async ({ businessId, type, note, subscriptionId, needsReview }) => {
        await BillingEvent.create({
          businessId,
          userId: input.userId,
          razorpaySubscriptionId: subscriptionId,
          eventType: type,
          source: 'recovery',
          eventAt: new Date(),
          actions: [],
          note,
          ...(needsReview && { needsReview: true }),
        }).catch((err: any) => console.error('[billing/recovery] audit write failed:', err?.message));
        if (needsReview) console.error(`[billing/recovery] NEEDS REVIEW business ${businessId}: ${type} — ${note}`);
      },
    },
    { ...input, cycle }
  );
}
