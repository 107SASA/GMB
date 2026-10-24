import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import Business from '@/models/Business';
import User from '@/models/User';
import TrialClaim from '@/models/TrialClaim';
import { requireBusinessContext } from '@/lib/tenant';
import { getRazorpay, getRazorpayKeyId, getRazorpayMode } from '@/lib/billing/razorpay';
import { otherModeSupportMessage, savedModeUsable, type RazorpayMode } from '@/lib/billing/razorpayMode';
import { ensureRazorpayPlanIdForCycle, getActivePlan, isBillingCycle, CYCLES, type BillingCycle } from '@/lib/billing/planCatalog';
import { decideCheckoutTrial, offerAppliesToCycle } from '@/lib/billing/billingPolicy';
import { attachSubscriptionToClaim, settleTrialReservation } from '@/lib/billing/trialClaims';
import { getTrialPolicy } from '@/services/billing/trialPolicyStore';
import { reserveTrialForCheckout, razorpaySettleDeps } from '@/services/billing/trialEligibility';
import { startRecoveryCheckout } from '@/services/billing/paymentRecoveryService';
import { decideTrialCheckoutReuse, previousUnpaidCheckout, recordedCheckoutMode, retirePreviousCheckout } from '@/lib/billing/checkoutGuard';
import { reconcileWorkspaceSubscription } from '@/lib/billing/razorpayReconcile';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Creates a Razorpay Subscription for THE plan (there is only one), scoped to
 * the ACTIVE workspace, and returns the params the Razorpay JS widget needs.
 * The workspace is resolved from the business context (activeBusinessId cookie
 * / x-business-id header). Entitlements are NOT granted here — only the webhook
 * (or the self-heal, with the same rules) flips them, so a closed checkout
 * window can't leave a half-activated state.
 *
 * Free trial (yearly offer): decided HERE, on the server, from the stored
 * policy + the phone's claim — never from anything the browser sent. The only
 * client inputs are `cycle` and `skipTrial` (declining a trial). A trial
 * checkout gets Razorpay start_at = trial end (first charge) and expire_by =
 * the claim's 24-hour window; its terms are frozen into the claim's snapshot.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    // The customer picks a billing duration (monthly/quarterly/6-month/yearly);
    // default to monthly for older clients that send no body.
    const body = await req.json().catch(() => ({}));
    const cycle: BillingCycle = isBillingCycle(body?.cycle) ? body.cycle : 'monthly';
    const skipTrial = body?.skipTrial === true;

    await dbConnect();
    const workspace = await Business.findById(ctx.businessId)
      .select('subscriptionStatus trialEndsAt subscriptionCancelAtPeriodEnd paymentAccessHold razorpaySubscriptionId razorpaySubscriptionEnv billingSubscriptionId')
      .lean<{
        subscriptionStatus?: string;
        trialEndsAt?: Date;
        subscriptionCancelAtPeriodEnd?: boolean;
        paymentAccessHold?: boolean;
        razorpaySubscriptionId?: string;
        razorpaySubscriptionEnv?: { subscriptionId: string; mode: RazorpayMode };
        billingSubscriptionId?: string;
      }>();
    if (workspace?.subscriptionStatus === 'trial_active') {
      return NextResponse.json(
        { error: 'This workspace is already on a free trial. Your plan starts automatically when it ends.', code: 'TRIAL_ACTIVE' },
        { status: 409 }
      );
    }
    // A paid workspace must never get a second subscription that can charge
    // it too. (Resubscribing after a cancel-at-period-end stays allowed: the
    // old subscription will not charge again.)
    if (workspace?.subscriptionStatus === 'active' && workspace.paymentAccessHold) {
      return NextResponse.json(
        { error: 'We received your payment and our team is restoring your access. No further payment is needed.', code: 'PAYMENT_UNDER_REVIEW' },
        { status: 409 }
      );
    }
    if (workspace?.subscriptionStatus === 'active' && !workspace.subscriptionCancelAtPeriodEnd) {
      return NextResponse.json(
        { error: 'This workspace already has an active subscription.', code: 'ALREADY_SUBSCRIBED' },
        { status: 409 }
      );
    }

    // Workspace-state refusals above need no Razorpay; everything below does.
    const razorpay = getRazorpay();
    const mode = getRazorpayMode();
    if (!razorpay || !mode) {
      return NextResponse.json(
        { error: 'Billing is not configured on this server' },
        { status: 503 }
      );
    }

    const activePlan = await getActivePlan();

    // Resolves the super-admin-configured price for the chosen cycle, creating a
    // matching Razorpay Plan on the fly if needed. Throws (caught below) if the
    // cycle isn't enabled.
    const duration = await ensureRazorpayPlanIdForCycle(cycle);
    if (!duration.razorpayPlanId) {
      return NextResponse.json(
        { error: 'Billing is not configured on this server' },
        { status: 503 }
      );
    }

    const user = await User.findById(ctx.userId).select('email phone').lean<{ email?: string; phone?: string }>();
    const widgetParams = (subscriptionId: string, description: string) => ({
      key: getRazorpayKeyId(),
      subscriptionId,
      planType: activePlan.planType,
      name: 'GrowwMatics AI',
      description,
      prefill: {
        email: user?.email ?? undefined,
        contact: user?.phone ?? undefined,
      },
    });

    // Before ANY new subscription is created below: the workspace's previous
    // unpaid checkout must not be able to charge alongside it (see
    // lib/billing/checkoutGuard.ts). Null = safe to create.
    const guardPreviousCheckout = async (): Promise<NextResponse | null> => {
      const previous = previousUnpaidCheckout(workspace);
      const guard = await retirePreviousCheckout(
        {
          fetchSubscription: async (id) => {
            const s: any = await razorpay.subscriptions.fetch(id);
            return { status: String(s.status), paidCount: Number(s.paid_count ?? 0) };
          },
          cancelSubscription: async (id) => {
            await razorpay.subscriptions.cancel(id, false);
          },
        },
        previous,
        { previousMode: recordedCheckoutMode(workspace, previous), currentMode: mode }
      );
      if (guard.kind === 'clear' || guard.kind === 'cancelled_previous') return null;
      if (guard.kind === 'test_checkout_ignored') {
        console.warn(`[billing/checkout] previous checkout ${guard.subscriptionId} for business ${ctx.businessId} was created with test keys — ignored under live keys`);
        return null;
      }
      if (guard.kind === 'payment_in_progress') {
        // Apply it now instead of waiting for a late webhook.
        await reconcileWorkspaceSubscription(ctx.businessId, { force: true, subscriptionId: guard.subscriptionId }).catch((err) =>
          console.error('[billing/checkout] reconcile of in-flight payment failed:', err?.message)
        );
        return NextResponse.json(
          { error: 'A payment for this workspace is already being processed. Please wait a moment and refresh — no new payment is needed.', code: 'PAYMENT_IN_PROGRESS' },
          { status: 409 }
        );
      }
      console.error(`[billing/checkout] previous checkout ${guard.subscriptionId} for business ${ctx.businessId} unresolved: ${guard.reason}`);
      return NextResponse.json(
        { error: "We couldn't safely start a new checkout right now, so nothing was charged. Please try again in a few minutes.", code: 'CHECKOUT_UNAVAILABLE' },
        { status: 503 }
      );
    };

    // ── Failed payment: safe recovery (never a second subscription that can
    // charge alongside the original, never a free trial) ──────────────────
    if (workspace?.subscriptionStatus === 'past_due') {
      const recovery = await startRecoveryCheckout({ businessId: ctx.businessId, userId: ctx.userId, cycle });
      switch (recovery.kind) {
        case 'checkout':
          return NextResponse.json({
            success: true,
            recovery: true,
            checkout: widgetParams(recovery.subscriptionId, `${activePlan.displayName} — ₹${duration.priceInr} / ${CYCLES[cycle].label}`),
            trial: null,
          });
        case 'already_paid':
          // Razorpay's own retry went through — nothing to pay.
          return NextResponse.json({ success: true, alreadyPaid: true });
        case 'busy':
          return NextResponse.json(
            { error: 'Your payment is already being set up. Please wait a moment and try again.', code: 'RECOVERY_IN_PROGRESS' },
            { status: 409 }
          );
        case 'unavailable':
          return NextResponse.json(
            {
              error: "We couldn't safely set up a new payment right now, so nothing was charged. Please try again in a few minutes, or contact support.",
              code: 'RECOVERY_UNAVAILABLE',
            },
            { status: 503 }
          );
        case 'not_needed':
          return NextResponse.json(
            { error: 'Your billing status just changed. Please refresh the page.', code: 'STATE_CHANGED' },
            { status: 409 }
          );
        case 'support_required':
          // Recorded under the other Razorpay keys: nothing was looked up, cancelled or created.
          return NextResponse.json(
            { error: otherModeSupportMessage(recovery.recordedMode), code: 'SUBSCRIPTION_NEEDS_SUPPORT' },
            { status: 409 }
          );
        default:
          // Never fall through to a new checkout for a past-due workspace.
          return NextResponse.json(
            { error: "We couldn't safely set up a new payment right now, so nothing was charged. Please contact support.", code: 'RECOVERY_UNAVAILABLE' },
            { status: 503 }
          );
      }
    }

    // ── Free trial path ────────────────────────────────────────────────────
    const policy = await getTrialPolicy();
    if (offerAppliesToCycle(policy, cycle) && !skipTrial) {
      const reservation = await reserveTrialForCheckout(ctx.userId, ctx.businessId);
      if (!reservation.trial && reservation.reason === 'phone_unverified') {
        // Not a silent downgrade: the customer chooses to verify (and get the
        // trial) or to pay now with skipTrial.
        return NextResponse.json(
          { error: 'Verify your phone number to start the free trial.', code: 'PHONE_VERIFICATION_REQUIRED' },
          { status: 409 }
        );
      }

      if (reservation.trial) {
        const claim = reservation.claim;

        // A second tab of the same workspace: reuse the subscription already
        // attached to this reservation instead of creating another — only
        // while Razorpay says it can still be authorized.
        if (claim.razorpaySubscriptionId && claim.offer) {
          let reuse: ReturnType<typeof decideTrialCheckoutReuse>;
          if (!savedModeUsable(claim.offer.razorpayMode, mode)) {
            // Created under the other keys (or legacy, now live): never handed to
            // this widget and not looked up — stays fail-closed (unknown).
            console.error(`[billing/checkout] attached trial checkout ${claim.razorpaySubscriptionId} is from another Razorpay mode — not reused`);
            reuse = 'unknown';
          } else {
            try {
              const s: any = await razorpay.subscriptions.fetch(claim.razorpaySubscriptionId);
              reuse = decideTrialCheckoutReuse({ status: String(s.status), paidCount: Number(s.paid_count ?? 0) });
            } catch (err: any) {
              console.error('[billing/checkout] could not check the attached trial checkout:', err?.error?.description || err?.message);
              reuse = 'unknown';
            }
          }
          if (reuse === 'reuse') {
            return NextResponse.json({
              success: true,
              checkout: widgetParams(claim.razorpaySubscriptionId, trialDescription(activePlan.displayName, duration.priceInr, claim.offer.trialEndsAt)),
              trial: trialTerms(claim.offer, duration.priceInr),
            });
          }
          if (reuse === 'payment_in_progress') {
            await reconcileWorkspaceSubscription(ctx.businessId, { force: true, subscriptionId: claim.razorpaySubscriptionId }).catch((err) =>
              console.error('[billing/checkout] reconcile of authorized trial failed:', err?.message)
            );
            return NextResponse.json(
              { error: 'Your free trial is already being set up. Please wait a moment and refresh — no new payment is needed.', code: 'PAYMENT_IN_PROGRESS' },
              { status: 409 }
            );
          }
          if (reuse === 'ended') {
            // Settle the reservation against Razorpay (releases it when it was
            // never authorized), so the next attempt starts a fresh checkout.
            await settleTrialReservation(TrialClaim, claim, razorpaySettleDeps, new Date()).catch((err) =>
              console.error('[billing/checkout] settling the ended trial checkout failed:', err?.message)
            );
            return NextResponse.json(
              { error: 'Your previous checkout window was closed, so nothing was charged. Please start checkout again.', code: 'CHECKOUT_ENDED' },
              { status: 409 }
            );
          }
          return NextResponse.json(
            { error: "We couldn't safely resume your checkout right now, so nothing was charged. Please try again in a few minutes.", code: 'CHECKOUT_UNAVAILABLE' },
            { status: 503 }
          );
        }

        const now = new Date();
        const decision = decideCheckoutTrial({ policy, cycle, eligible: true, now });
        if (decision.trial) {
          const blocked = await guardPreviousCheckout();
          if (blocked) return blocked;
          const reservedUntil = new Date(claim.reservedUntil);
          const rpSubscription = await razorpay.subscriptions.create({
            plan_id: duration.razorpayPlanId,
            customer_notify: 1,
            total_count: CYCLES[cycle].totalCount,
            start_at: Math.floor(decision.trialEndsAt.getTime() / 1000),
            expire_by: Math.floor(reservedUntil.getTime() / 1000),
            notes: {
              userId: ctx.userId,
              businessId: ctx.businessId,
              planType: activePlan.planType,
              billingCycle: cycle,
              trial: '1',
              trialClaimId: String(claim._id),
              trialMonths: String(decision.trialMonths),
              policyVersion: String(policy.version),
            },
          } as any);

          const offer = {
            trialMonths: decision.trialMonths,
            trialEndsAt: decision.trialEndsAt,
            razorpayPlanId: duration.razorpayPlanId,
            amountPaise: duration.priceInr * 100,
            currency: 'INR' as const,
            policyVersion: policy.version,
            decidedAt: now,
            razorpayMode: mode,
          };
          const attached = await attachSubscriptionToClaim(TrialClaim, {
            claimId: claim._id,
            businessId: ctx.businessId,
            razorpaySubscriptionId: rpSubscription.id,
            now,
            offer,
          });
          if (!attached) {
            // Another request attached first (or the window just closed). Never
            // hand this subscription to the browser — cancel it.
            await razorpay.subscriptions.cancel(rpSubscription.id, false).catch((err: any) =>
              console.error('[billing/checkout] could not cancel unattached trial subscription', rpSubscription.id, err?.error?.description || err?.message)
            );
            return NextResponse.json(
              { error: 'Your checkout was already started in another window. Please refresh and try again.', code: 'CHECKOUT_IN_PROGRESS' },
              { status: 409 }
            );
          }

          await linkCheckout(ctx.userId, ctx.businessId, rpSubscription.id, mode);
          return NextResponse.json({
            success: true,
            checkout: widgetParams(rpSubscription.id, trialDescription(activePlan.displayName, duration.priceInr, decision.trialEndsAt)),
            trial: trialTerms(offer, duration.priceInr),
          });
        }
      }
      // Not eligible (phone already used, workspace history, paid customer…)
      // → the normal paid checkout below, same as when the offer is OFF.
    }

    // ── Normal paid checkout ────────────────────────────────────────────────
    const blocked = await guardPreviousCheckout();
    if (blocked) return blocked;
    const rpSubscription = await razorpay.subscriptions.create({
      plan_id: duration.razorpayPlanId,
      customer_notify: 1,
      total_count: CYCLES[cycle].totalCount,
      notes: {
        // The webhook resolves the user AND the workspace from these notes.
        userId: ctx.userId,
        businessId: ctx.businessId,
        planType: activePlan.planType,
        billingCycle: cycle,
        trial: '0',
      },
    });

    await linkCheckout(ctx.userId, ctx.businessId, rpSubscription.id, mode);

    return NextResponse.json({
      success: true,
      checkout: widgetParams(rpSubscription.id, `${activePlan.displayName} — ₹${duration.priceInr} / ${CYCLES[cycle].label}`),
      trial: null,
    });
  } catch (error: any) {
    if (error?.code === 'PLAN_CHANGED') {
      // The price changed while its Razorpay plan was being created: nothing was created for the customer.
      return NextResponse.json({ error: error.message, code: 'PLAN_CHANGED' }, { status: 409 });
    }
    console.error('Checkout error:', error);
    // Razorpay's own error.error.description is already a clean, human
    // sentence when present ("The id provided does not exist", etc.) — only
    // fall back to the generic translator for everything else (Mongo,
    // network, unexpected shapes) rather than ever showing raw error.message.
    return NextResponse.json(
      { error: error?.error?.description || toFriendlyMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * Link the Razorpay subscription now (entitlements unchanged until the webhook
 * confirms). Linked on both the workspace (per-workspace access gate) and the
 * user's Subscription doc (usage-limit plumbing). A Subscription doc created
 * here is a FREE one — never the schema's old 14-day trial. The Razorpay mode
 * it was created in is recorded with it (see checkoutGuard.recordedCheckoutMode).
 */
async function linkCheckout(userId: string, businessId: string, subscriptionId: string, mode: RazorpayMode) {
  await Business.updateOne(
    { _id: businessId },
    { $set: { razorpaySubscriptionId: subscriptionId, razorpaySubscriptionEnv: { subscriptionId, mode } } }
  );
  await Subscription.findOneAndUpdate(
    { userId },
    {
      $set: { razorpaySubscriptionId: subscriptionId },
      $setOnInsert: { planType: 'Free', billingStatus: 'Active', trialStatus: { isActive: false } },
    },
    { upsert: true }
  );
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function trialDescription(planName: string, priceInr: number, trialEndsAt: Date | string) {
  return `${planName} — free until ${formatDate(trialEndsAt)}, then ₹${priceInr} / year`;
}

/** Terms shown before authorization — all server-computed. */
function trialTerms(offer: { trialMonths: number; trialEndsAt: Date | string; amountPaise: number }, priceInr: number) {
  return {
    months: offer.trialMonths,
    trialEndsAt: new Date(offer.trialEndsAt).toISOString(),
    firstChargeAt: new Date(offer.trialEndsAt).toISOString(),
    firstChargeInr: offer.amountPaise / 100 || priceInr,
    billing: 'yearly',
  };
}
