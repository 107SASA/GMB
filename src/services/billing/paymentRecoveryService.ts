import Business from '@/models/Business';
import BillingEvent from '@/models/BillingEvent';
import { getRazorpay } from '@/lib/billing/razorpay';
import { ensureRazorpayPlanIdForCycle, getActivePlan, CYCLES, isBillingCycle, type BillingCycle } from '@/lib/billing/planCatalog';
import { reconcileWorkspaceSubscription } from '@/lib/billing/razorpayReconcile';
import { prepareRecoveryCheckout, type RecoveryResult } from '@/lib/billing/paymentRecovery';

/**
 * Production wiring for the safe recovery checkout (lib/billing/paymentRecovery.ts):
 * real Razorpay calls, and every step recorded in the BillingEvent audit
 * trail (failed / ambiguous operations flagged needsReview for operators).
 */
export async function startRecoveryCheckout(input: { businessId: string; userId: string; cycle: string }): Promise<RecoveryResult> {
  const razorpay = getRazorpay();
  if (!razorpay) return { kind: 'unavailable', reason: 'billing_not_configured' };
  const cycle: BillingCycle = isBillingCycle(input.cycle) ? input.cycle : 'yearly';

  return prepareRecoveryCheckout(
    {
      Business,
      now: () => new Date(),
      fetchSubscription: async (id) => {
        const sub: any = await razorpay.subscriptions.fetch(id);
        return { status: String(sub.status), paidCount: Number(sub.paid_count ?? 0) };
      },
      cancelSubscription: async (id) => {
        await razorpay.subscriptions.cancel(id, false);
      },
      createSubscription: async ({ businessId, userId, replaces, expireBy }) => {
        const plan = await getActivePlan();
        const duration = await ensureRazorpayPlanIdForCycle(cycle);
        if (!duration.razorpayPlanId) throw new Error('billing plan not configured');
        return razorpay.subscriptions.create({
          plan_id: duration.razorpayPlanId,
          customer_notify: 1,
          total_count: CYCLES[cycle].totalCount,
          expire_by: Math.floor(expireBy.getTime() / 1000),
          notes: {
            userId,
            businessId,
            planType: plan.planType,
            billingCycle: cycle,
            trial: '0',
            recoveryOf: replaces ?? '',
          },
        } as any);
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
