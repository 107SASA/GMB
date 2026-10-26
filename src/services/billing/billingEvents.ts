import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import BillingPlan from '@/models/BillingPlan';
import TrialClaim from '@/models/TrialClaim';
import BillingEvent from '@/models/BillingEvent';
import { getRazorpay, getRazorpayMode } from '@/lib/billing/razorpay';
import { subscriptionModeVerdict } from '@/lib/billing/razorpayMode';
import { isBillingCycle, isPaidPlanType } from '@/lib/billing/planCatalog';
import {
  activatePlan,
  activateBusinessPlan,
  cancelBusinessPlan,
  markPastDue,
  markBusinessPastDue,
  startTrialAccess,
  markTrialCancelled,
  userHasOtherPlanWorkspace,
  endUserPlanUnlessOtherWorkspacePaid,
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
import { recordedCheckoutMode } from '@/lib/billing/checkoutGuard';
import { razorpaySettleDeps } from '@/services/billing/trialEligibility';
import { openRecoveryEpisode, closeRecoveryEpisodes } from '@/services/billing/recoveryRemindersService';
import { stopPreSalesNurtureForWorkspace } from '@/services/sales/preSalesPolicy';
import { notifyPaymentConfirmed, paymentNoticeKind } from '@/services/billing/billingWhatsApp';

/**
 * Loads the facts for one Razorpay subscription event, asks the pure state
 * machine (lib/billing/subscriptionMachine.ts) what may change, and does it.
 * Used by the webhook AND the self-heal, so both follow the same rules.
 * Every call is recorded in BillingEvent, including ignored events.
 */

async function resolveBusiness(subEntity: any, paymentEntity: any): Promise<any | null> {
  const notesBusinessId = subEntity?.notes?.businessId ?? paymentEntity?.notes?.businessId;
  const fields =
    '_id userId subscriptionStatus billingSubscriptionId billingSubscriptionEnv razorpaySubscriptionId razorpaySubscriptionEnv recoveryCheckout trialEndsAt trialCancelledAt billingLastEventAt supersededSubscriptionIds subscriptionCancelAtPeriodEnd';
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

/**
 * Cancels a trial subscription that was refused a trial. True only when
 * Razorpay confirms it can no longer charge — otherwise it would charge the
 * full price at its start date with no access, so the caller flags it.
 */
async function cancelRejectedTrial(subId: string): Promise<boolean> {
  const razorpay = getRazorpay();
  if (!razorpay) return false;
  try {
    // Immediate cancel: an authenticated (future-start) subscription has no
    // billing cycle yet, so nothing is charged.
    await razorpay.subscriptions.cancel(subId, false);
    return true;
  } catch (err: any) {
    console.error(`[billing] could not cancel rejected trial subscription ${subId}:`, err?.error?.description || err?.message);
  }
  try {
    const s: any = await razorpay.subscriptions.fetch(subId);
    return ['cancelled', 'expired', 'completed'].includes(String(s?.status));
  } catch {
    return false;
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

  // Razorpay mode guard. The subscription is the one in the signed payload;
  // its mode comes only from records naming exactly that id (paying
  // subscription, checkout link, open recovery checkout, trial offer snapshot)
  // — never from the configured keys. Recorded in the other mode, or records
  // that disagree → nothing is applied (no grant, extension, failure or
  // cancellation); a person reviews it. No record → unchanged behaviour below.
  const currentMode = getRazorpayMode();
  const recordedMode = sub
    ? subscriptionModeVerdict(
        [
          business?.billingSubscriptionEnv,
          business?.razorpaySubscriptionEnv,
          business?.recoveryCheckout,
          claimDoc?.razorpaySubscriptionId === sub.id ? { subscriptionId: sub.id, mode: claimDoc?.offer?.razorpayMode } : null,
        ],
        sub.id
      )
    : null;
  if (sub && currentMode && recordedMode && recordedMode !== currentMode) {
    const note =
      recordedMode === 'ambiguous'
        ? `records disagree on the Razorpay mode of ${sub.id} — ${type} not applied`
        : `${sub.id} was created in ${recordedMode} mode but ${currentMode} keys are configured — ${type} not applied`;
    console.error(`[billing] NEEDS REVIEW business ${businessId}: ${note}`);
    await BillingEvent.create({
      businessId: businessId ?? undefined,
      userId: userId ?? undefined,
      razorpaySubscriptionId: sub.id,
      razorpayEventId: input.razorpayEventId,
      eventType: type,
      source,
      eventAt,
      statusBefore: business?.subscriptionStatus ?? undefined,
      statusAfter: business?.subscriptionStatus ?? undefined,
      actions: [],
      note,
      needsReview: true,
    }).catch((err: any) => console.error('[billing] BillingEvent write failed:', err?.message));
    return { decision: { actions: [], recordEvent: false, note }, businessId, userId };
  }

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
        subscriptionCancelAtPeriodEnd: business.subscriptionCancelAtPeriodEnd ?? null,
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
        subscriptionEndedAt: claimDoc.subscriptionEndedAt ? new Date(claimDoc.subscriptionEndedAt) : null,
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
  // The mode this subscription was created in — only when its checkout-link
  // record names exactly this id; never inferred (null = unknown).
  const subscriptionMode = sub ? recordedCheckoutMode(business, sub.id) : null;
  const reviewReasons: string[] = [];
  // Mode not recorded anywhere (legacy): applied as before — it may be a real
  // live payment — but a grant/extension under live keys goes to review.
  if (
    sub && currentMode === 'live' && recordedMode === null &&
    decision.actions.some((a) => a.kind === 'start_trial' || a.kind === 'activate_paid')
  ) {
    reviewReasons.push(`Razorpay mode of ${sub.id} is not recorded — applied as before; confirm it is a live subscription`);
  }

  for (const action of decision.actions) {
    switch (action.kind) {
      case 'consume_claim':
        await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: sub!.id, now: new Date() });
        break;
      case 'start_trial':
        await startTrialAccess(businessId!, userId, { subscriptionId: sub!.id, trialEndsAt: action.trialEndsAt, eventAt: stampAt, cancelled: action.cancelled === true, subscriptionMode });
        // A trial user is out of pre-sales nurture (no more sales follow-ups).
        if (businessId) await stopPreSalesNurtureForWorkspace(businessId, 'trial-started');
        break;
      case 'reject_trial':
        console.error(`[billing] trial rejected for ${sub?.id} (business ${businessId}): ${action.reason}`);
        if (!(await cancelRejectedTrial(sub!.id))) {
          reviewReasons.push(`rejected trial subscription ${sub?.id} could not be confirmed cancelled — it may charge at its start date`);
        }
        break;
      case 'activate_paid': {
        // planType comes from our checkout notes ('Pro', or 'Enterprise' on
        // legacy subscriptions) — validated, never trusted blindly.
        if (!userId || !isPaidPlanType(subEntity?.notes?.planType)) {
          console.error(`[billing] ${type}: cannot resolve user/plan`, sub?.id);
          break;
        }
        let held = false;
        // First charge vs renewal from Razorpay's own counter (paid_count),
        // not the workspace's current status: an `activated` and a `charged`
        // event for the same first charge are both "first".
        const isRenewalCharge = paymentNoticeKind(sub!.paidCount) === 'renewal';
        if (businessId) {
          ({ held } = await activateBusinessPlan(businessId, {
            currentPeriodEnd: action.periodEnd ?? undefined,
            eventType: isRenewalCharge ? 'subscription.charged' : 'subscription.activated',
            subscriptionId: sub!.id,
            subscriptionMode,
            eventAt: stampAt,
            // Revenue reporting: the cycle from our own checkout notes and the captured amount.
            ...(isBillingCycle(subEntity?.notes?.billingCycle) && { billingCycle: subEntity.notes.billingCycle }),
            ...(payment?.status === 'captured' && typeof payment.amount === 'number' && { amountInr: payment.amount / 100 }),
          }));
        } else {
          console.warn(`[billing] ${type}: cannot resolve workspace for ${sub?.id}`);
        }
        await activatePlan(userId, { razorpaySubscriptionId: sub!.id, currentPeriodEnd: action.periodEnd ?? undefined, held });
        // Verified payment: the failure is over — stop its reminders now.
        if (businessId) await closeRecoveryEpisodes(businessId, 'resolved', 'payment_recovered');
        // ...and pre-sales nurture, even when no platform Lead matches the phone.
        if (businessId) await stopPreSalesNurtureForWorkspace(businessId, 'payment-verified');
        // One WhatsApp per verified charge (first payment or renewal), for
        // webhook AND reconciliation activations — the per-charge claim makes
        // whichever arrives second a no-op. Skipped while access is held.
        // Never throws and never touches payment/entitlement state.
        if (businessId) {
          await notifyPaymentConfirmed({
            businessId,
            subscriptionId: sub!.id,
            paidCount: sub!.paidCount,
            subscriptionNotes: subEntity?.notes,
            periodEnd: action.periodEnd ?? null,
          });
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
        // User-level entitlements are shared by the user's workspaces — another still-paid one keeps them.
        if (userId && !(await userHasOtherPlanWorkspace(userId, businessId))) await markPastDue(userId, snapshot);
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
        if (userId) await endUserPlanUnlessOtherWorkspacePaid(userId, businessId);
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
      case 'flag_duplicate_subscription':
      case 'flag_payment_review':
        // Nothing changes automatically — the BillingEvent below goes to the review queue.
        reviewReasons.push(decision.note);
        break;
      case 'record_trial_subscription_ended':
        await TrialClaim.updateOne(
          { razorpaySubscriptionId: sub!.id, subscriptionEndedAt: { $exists: false } },
          { $set: { subscriptionEndedAt: eventAt } }
        );
        break;
      case 'failure_continues':
        // Day 0, grace and reminders stay as frozen; only the facts move on.
        if (businessId && (action.halted || stampAt)) {
          await Business.updateOne(
            { _id: businessId, subscriptionStatus: 'past_due' },
            {
              ...(action.halted && { $set: { paymentFailureReason: 'retries_exhausted' } }),
              ...(stampAt && { $max: { billingLastEventAt: stampAt } }),
            }
          );
        }
        break;
    }
  }
  for (const reason of reviewReasons) console.error(`[billing] NEEDS REVIEW business ${businessId}: ${reason}`);
  const needsReview = reviewReasons.length > 0;

  // The self-heal re-reads Razorpay every 30 minutes: an unchanged state
  // (nothing applied, or the same open failure) is not recorded again.
  // Webhooks are always recorded — each is a distinct Razorpay event.
  const unchanged = decision.actions.every((a) => a.kind === 'failure_continues');
  if (source === 'reconcile' && unchanged && !needsReview) {
    return { decision, businessId, userId };
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
    note: [decision.note, ...reviewReasons.filter((r) => r !== decision.note)].join(' | '),
    amountPaise: payment?.amount ?? undefined,
    currency: payment?.currency ?? undefined,
    ...(needsReview && { needsReview: true }),
  }).catch((err: any) => console.error('[billing] BillingEvent write failed:', err?.message));

  if (decision.actions.length === 0) {
    console.log(`[billing] ${source} ${type} ${sub?.id ?? ''}: no change — ${decision.note}`);
  }
  return { decision, businessId, userId };
}
