import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import BillingPlan from '@/models/BillingPlan';
import TrialClaim from '@/models/TrialClaim';
import BillingEvent from '@/models/BillingEvent';
import { getRazorpay } from '@/lib/billing/razorpay';
import { isPaidPlanType } from '@/lib/billing/planCatalog';
import {
  activatePlan,
  activateBusinessPlan,
  cancelPlan,
  cancelBusinessPlan,
  markPastDue,
  markBusinessPastDue,
  startTrialAccess,
  markTrialCancelled,
} from '@/lib/billing/applyEntitlements';
import {
  decideBillingEvent,
  subscriptionFactsFrom,
  paymentFactsFrom,
  type BillingDecision,
  type ClaimFacts,
  type WorkspaceFacts,
} from '@/lib/billing/subscriptionMachine';
import { consumeTrialClaim, settleTrialReservation } from '@/lib/billing/trialClaims';
import { razorpaySettleDeps } from '@/services/billing/trialEligibility';
import { openRecoveryEpisode, closeRecoveryEpisodes } from '@/services/billing/recoveryRemindersService';

/**
 * Loads the facts for one Razorpay subscription event, asks the pure state
 * machine (lib/billing/subscriptionMachine.ts) what may change, and does it.
 * Used by the webhook AND the self-heal, so both follow the same rules.
 * Every call is recorded in BillingEvent, including ignored events.
 */

async function resolveBusiness(subEntity: any, paymentEntity: any): Promise<any | null> {
  const notesBusinessId = subEntity?.notes?.businessId ?? paymentEntity?.notes?.businessId;
  const fields =
    '_id userId subscriptionStatus billingSubscriptionId razorpaySubscriptionId trialEndsAt trialCancelledAt billingLastEventAt supersededSubscriptionIds';
  if (typeof notesBusinessId === 'string' && notesBusinessId) {
    const b = await Business.findById(notesBusinessId).select(fields).lean();
    if (b) return b;
  }
  if (subEntity?.id) {
    return (
      (await Business.findOne({ billingSubscriptionId: subEntity.id }).select(fields).lean()) ??
      (await Business.findOne({ razorpaySubscriptionId: subEntity.id }).select(fields).lean())
    );
  }
  return null;
}

async function resolveUserId(subEntity: any, paymentEntity: any, business: any, claim: any): Promise<string | null> {
  const fromNotes = subEntity?.notes?.userId ?? paymentEntity?.notes?.userId;
  if (typeof fromNotes === 'string' && fromNotes) return fromNotes;
  if (claim?.userId) return String(claim.userId);
  if (subEntity?.id) {
    const sub = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id }).select('userId').lean<any>();
    if (sub?.userId) return String(sub.userId);
  }
  return business?.userId ? String(business.userId) : null;
}

/** What a NON-trial charge on this plan must be, when we created that Razorpay plan (paise). */
async function expectedPlanAmountPaise(planId: string | null): Promise<number | null> {
  if (!planId) return null;
  const doc = await BillingPlan.findOne({ key: 'default' }).lean<any>();
  const duration = (doc?.durations ?? []).find((d: any) => d.razorpayPlanId === planId && d.razorpayPlanPriceInr);
  if (duration) return duration.razorpayPlanPriceInr * 100;
  if (doc?.razorpayPlanId === planId && doc?.razorpayPlanPriceInr) return doc.razorpayPlanPriceInr * 100;
  return null; // legacy / env plan — amount unknown, behave as before
}

async function cancelRejectedTrial(subId: string): Promise<void> {
  const razorpay = getRazorpay();
  if (!razorpay) return;
  try {
    // Immediate cancel: an authenticated (future-start) subscription has no
    // billing cycle yet, so nothing is charged.
    await razorpay.subscriptions.cancel(subId, false);
  } catch (err: any) {
    console.error(`[billing] could not cancel rejected trial subscription ${subId}:`, err?.error?.description || err?.message);
  }
}

async function movePlatformLeadOnFailure(userId: string | null, businessId: string | null, eventType: string) {
  if (!userId && !businessId) return;
  try {
    const { resolveLeadForPayment } = await import('@/services/billing/customerActivation');
    const { stageOnPaymentFailure } = await import('@/services/billing/paymentLeadStages');
    const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
    const lead = await resolveLeadForPayment(userId || '', businessId || null);
    const nextStage = stageOnPaymentFailure(lead?.currentStage);
    if (lead && nextStage) {
      await setLeadOwnership(lead._id, (lead.currentAgent as any) || 'SALES', `razorpay:${eventType}`, 'system', nextStage);
    }
  } catch (err: any) {
    console.warn(`[billing] ${eventType}: platform lead stage update failed:`, err?.message);
  }
}

export interface ApplyEventInput {
  type: string;
  eventAt: Date;
  subEntity: any;
  paymentEntity: any;
  source: 'webhook' | 'reconcile';
  razorpayEventId?: string;
}

// The self-heal applies Razorpay's CURRENT state: it skips the out-of-order
// check and never stamps billingLastEventAt, so it can't make a later real
// webhook look stale.

export async function applyRazorpayEvent(input: ApplyEventInput): Promise<{ decision: BillingDecision; businessId: string | null; userId: string | null }> {
  await dbConnect();
  const { type, eventAt, subEntity, paymentEntity, source } = input;
  const sub = subscriptionFactsFrom(subEntity);
  const payment = paymentFactsFrom(paymentEntity);

  const business = await resolveBusiness(subEntity, paymentEntity);
  const claimDoc = sub ? await TrialClaim.findOne({ razorpaySubscriptionId: sub.id }).lean<any>() : null;
  const userId = await resolveUserId(subEntity, paymentEntity, business, claimDoc);
  const businessId = business?._id ? String(business._id) : null;

  const workspace: WorkspaceFacts | null = business
    ? {
        id: businessId!,
        subscriptionStatus: business.subscriptionStatus ?? null,
        billingSubscriptionId: business.billingSubscriptionId ?? null,
        razorpaySubscriptionId: business.razorpaySubscriptionId ?? null,
        trialEndsAt: business.trialEndsAt ?? null,
        trialCancelledAt: business.trialCancelledAt ?? null,
        billingLastEventAt: business.billingLastEventAt ?? null,
        supersededSubscriptionIds: business.supersededSubscriptionIds ?? [],
      }
    : null;
  const claim: ClaimFacts | null = claimDoc
    ? {
        status: claimDoc.status,
        businessId: String(claimDoc.businessId),
        attachedSubscriptionId: claimDoc.razorpaySubscriptionId ?? null,
        offer: claimDoc.offer
          ? {
              razorpayPlanId: claimDoc.offer.razorpayPlanId,
              amountPaise: claimDoc.offer.amountPaise,
              currency: claimDoc.offer.currency,
              trialEndsAt: new Date(claimDoc.offer.trialEndsAt),
            }
          : null,
      }
    : null;

  const decision = decideBillingEvent({
    type,
    eventAt,
    sub,
    payment,
    workspace,
    claim,
    expectedPaidAmountPaise: sub && !sub.isTrial ? await expectedPlanAmountPaise(sub.planId) : null,
    authoritative: source === 'reconcile',
  });
  const stampAt = source === 'webhook' ? eventAt : undefined;

  for (const action of decision.actions) {
    switch (action.kind) {
      case 'consume_claim':
        await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: sub!.id, now: new Date() });
        break;
      case 'start_trial':
        await startTrialAccess(businessId!, userId, { subscriptionId: sub!.id, trialEndsAt: action.trialEndsAt, eventAt: stampAt });
        break;
      case 'reject_trial':
        console.error(`[billing] trial rejected for ${sub?.id} (business ${businessId}): ${action.reason}`);
        await cancelRejectedTrial(sub!.id);
        break;
      case 'activate_paid': {
        // planType comes from our checkout notes ('Pro', or 'Enterprise' on
        // legacy subscriptions) — validated, never trusted blindly.
        if (!userId || !isPaidPlanType(subEntity?.notes?.planType)) {
          console.error(`[billing] ${type}: cannot resolve user/plan`, sub?.id);
          break;
        }
        let held = false;
        if (businessId) {
          ({ held } = await activateBusinessPlan(businessId, {
            currentPeriodEnd: action.periodEnd ?? undefined,
            eventType: action.renewal ? 'subscription.charged' : 'subscription.activated',
            subscriptionId: sub!.id,
            eventAt: stampAt,
          }));
        } else {
          console.warn(`[billing] ${type}: cannot resolve workspace for ${sub?.id}`);
        }
        await activatePlan(userId, { razorpaySubscriptionId: sub!.id, currentPeriodEnd: action.periodEnd ?? undefined, held });
        // Verified payment: the failure is over — stop its reminders now.
        if (businessId) await closeRecoveryEpisodes(businessId, 'resolved', 'payment_recovered');
        if (source === 'webhook') {
          // Sent once per subscription (guarded) — see paymentReceivedNotice.ts.
          const { sendPaymentReceivedMessage } = await import('@/services/billing/paymentReceivedNotice');
          await sendPaymentReceivedMessage(userId, businessId);
        }
        // Idempotent post-payment sequence (each step guarded by its own flag).
        try {
          const { runCustomerActivationSequence } = await import('@/services/billing/customerActivation');
          await runCustomerActivationSequence(userId, businessId, {
            paymentId: paymentEntity?.id,
            amount: typeof paymentEntity?.amount === 'number' ? paymentEntity.amount : undefined,
            currency: paymentEntity?.currency,
          });
        } catch (err) {
          console.error('[billing] customerActivation sequence failed', err);
        }
        break;
      }
      case 'payment_failed': {
        // The workspace freezes the policy at Day 0; the user gets the same snapshot.
        const snapshot = businessId ? await markBusinessPastDue(businessId, { reason: action.reason, eventAt: stampAt }) : null;
        if (userId) await markPastDue(userId, snapshot);
        // A NEW failure (not a retry of an open one) → its reminder episode, Day 0 = now.
        if (snapshot && businessId) {
          await openRecoveryEpisode({ businessId, userId, razorpaySubscriptionId: sub?.id, snapshot });
        }
        await movePlatformLeadOnFailure(userId, businessId, type);
        break;
      }
      case 'lead_payment_failed':
        await movePlatformLeadOnFailure(userId, businessId, type);
        break;
      case 'trial_cancelled':
        if (businessId) await markTrialCancelled(businessId, userId, { eventAt: stampAt });
        break;
      case 'cancel_paid':
        if (userId) await cancelPlan(userId);
        if (businessId) {
          await cancelBusinessPlan(businessId);
          await closeRecoveryEpisodes(businessId, 'stopped', 'subscription_cancelled');
          if (stampAt) await Business.updateOne({ _id: businessId }, { $max: { billingLastEventAt: stampAt } });
        }
        break;
      case 'settle_claim': {
        const fresh = await TrialClaim.findOne({ razorpaySubscriptionId: sub!.id }).lean<any>();
        if (fresh) await settleTrialReservation(TrialClaim, fresh, razorpaySettleDeps, new Date());
        break;
      }
    }
  }

  const after = businessId ? await Business.findById(businessId).select('subscriptionStatus').lean<any>() : null;
  await BillingEvent.create({
    businessId: businessId ?? undefined,
    userId: userId ?? undefined,
    razorpaySubscriptionId: sub?.id,
    razorpayEventId: input.razorpayEventId,
    eventType: type,
    source,
    eventAt,
    statusBefore: workspace?.subscriptionStatus ?? undefined,
    statusAfter: after?.subscriptionStatus ?? undefined,
    actions: decision.actions.map((a) => a.kind),
    note: decision.note,
    amountPaise: payment?.amount ?? undefined,
    currency: payment?.currency ?? undefined,
  }).catch((err: any) => console.error('[billing] BillingEvent write failed:', err?.message));

  if (decision.actions.length === 0) {
    console.log(`[billing] ${source} ${type} ${sub?.id ?? ''}: no change — ${decision.note}`);
  }
  return { decision, businessId, userId };
}
