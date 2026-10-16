import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';

/**
 * One free trial per verified phone number, for one workspace.
 *
 * This file holds the rules (pure) and the atomic claim operations (Mongo
 * model passed in), with no `@/` imports so tests can load it directly.
 * services/billing/trialEligibility.ts wires it to the real models and
 * Razorpay.
 *
 * Lifecycle of a claim (models/TrialClaim.ts):
 *   none ──reserve──▶ reserved ──authenticated──▶ consumed   (permanent)
 *                        │
 *                        └─ Razorpay confirms the checkout can no longer be
 *                           authorized (expired / cancelled before auth) ──▶ released
 * A released claim can be reserved again; it never granted a trial.
 */

/** A trial checkout must be authorized within this window (Razorpay expire_by uses the same instant). */
export const TRIAL_RESERVATION_MS = 24 * 60 * 60 * 1000;

/** One-way key for the phone, so the claim can outlive account deletion without keeping the number. */
export function trialPhoneHash(phoneKey: string): string {
  return createHash('sha256').update(`growwmatics-trial-claim:v1:${phoneKey}`).digest('hex');
}

// ── Eligibility rules ───────────────────────────────────────────────────────

export interface WorkspaceBillingFacts {
  subscriptionStatus?: string | null;
  subscriptionCurrentPeriodEnd?: Date | string | null;
  trialStartedAt?: Date | string | null;
}

/**
 * True when this workspace has ever been paid for or trialled. Only a
 * successful activation stamps a paid-through date, so a 'past_due' or
 * 'canceled' status WITHOUT one (a declined checkout, an expired unpaid
 * checkout) is not paid history.
 */
export function workspaceHasBillingHistory(ws: WorkspaceBillingFacts | null | undefined): boolean {
  if (!ws) return false;
  return ws.subscriptionStatus === 'active' || !!ws.subscriptionCurrentPeriodEnd || !!ws.trialStartedAt;
}

export interface PhonePaidFacts {
  /** User.subscriptionPlan of every account on this phone. */
  userPlans: Array<string | null | undefined>;
  /** Subscription docs of those accounts. */
  subscriptions: Array<{ planType?: string | null; currentPeriodEnd?: Date | string | null }>;
  /** Every workspace those accounts own. */
  workspaces: WorkspaceBillingFacts[];
}

/** True when any account on this phone is, or ever was, a paying customer. */
export function phoneHasPaidHistory(facts: PhonePaidFacts): boolean {
  if (facts.userPlans.some((p) => !!p && p !== 'Free')) return true;
  if (facts.subscriptions.some((s) => (s.planType && s.planType !== 'Free') || !!s.currentPeriodEnd)) return true;
  return facts.workspaces.some(workspaceHasBillingHistory);
}

export type TrialIneligibleReason =
  | 'phone_invalid'
  | 'phone_unverified'
  | 'workspace_history'
  | 'paid_history';

export function trialEligibility(input: {
  phoneKey: string | null;
  phoneVerified: boolean;
  workspace: WorkspaceBillingFacts | null;
  phonePaid: PhonePaidFacts;
}): { eligible: true } | { eligible: false; reason: TrialIneligibleReason } {
  if (!input.phoneKey) return { eligible: false, reason: 'phone_invalid' };
  if (!input.phoneVerified) return { eligible: false, reason: 'phone_unverified' };
  if (workspaceHasBillingHistory(input.workspace)) return { eligible: false, reason: 'workspace_history' };
  if (phoneHasPaidHistory(input.phonePaid)) return { eligible: false, reason: 'paid_history' };
  return { eligible: true };
}

// ── Settling an expired reservation ─────────────────────────────────────────

/** What Razorpay says about the reservation's subscription. */
export interface RazorpaySubscriptionFacts {
  status: string;
  paidCount?: number;
  /** Razorpay fills payment_method / customer_id once a customer has authorized. */
  hasPaymentMethod?: boolean;
  hasCustomer?: boolean;
}

export type SettleAction =
  | 'keep'                // not ours to change (not reserved, or Razorpay unreachable / unknown status)
  | 'not_expired'         // still inside the authorization window
  | 'consume'             // the customer did authorize (a webhook is late) — the trial is used
  | 'release'             // verified that it can never be authorized
  | 'cancel_then_recheck' // window passed but Razorpay still says 'created' — cancel it, then ask again
  | 'needs_review';       // cancelled, but it may have been authorized first — never guess

const AUTHORIZED_STATUSES = new Set(['authenticated', 'active', 'pending', 'halted', 'paused', 'completed']);

export function settleAction(
  claim: { status: string; reservedUntil?: Date | null; razorpaySubscriptionId?: string | null },
  razorpay: RazorpaySubscriptionFacts | 'unavailable' | null,
  now: Date
): SettleAction {
  if (claim.status !== 'reserved') return 'keep';
  const expired = !!claim.reservedUntil && new Date(claim.reservedUntil).getTime() <= now.getTime();

  // No subscription was ever attached: checkout never handed a subscription id
  // to the browser (attach happens first), so nothing can be authorized.
  if (!claim.razorpaySubscriptionId) return expired ? 'release' : 'not_expired';

  if (razorpay === 'unavailable' || razorpay === null) return 'keep';
  if (AUTHORIZED_STATUSES.has(razorpay.status)) return 'consume';
  if (razorpay.status === 'expired') return 'release';
  if (razorpay.status === 'cancelled') {
    const mayHaveAuthorized = (razorpay.paidCount ?? 0) > 0 || !!razorpay.hasPaymentMethod || !!razorpay.hasCustomer;
    return mayHaveAuthorized ? 'needs_review' : 'release';
  }
  if (razorpay.status === 'created') return expired ? 'cancel_then_recheck' : 'not_expired';
  return 'keep';
}

// ── Atomic claim operations ─────────────────────────────────────────────────

type ClaimModel = Model<any>;

export type ReserveResult =
  | { ok: true; claim: any; reused: boolean }
  | { ok: false; reason: 'phone_claimed' | 'workspace_claimed' }
  | { ok: false; reason: 'reservation_expired'; claim: any };

/**
 * Reserves the phone's one trial for this workspace. Atomic: the unique
 * phoneHash / holderBusinessId indexes decide every race, so at most one
 * workspace can hold the claim. An unexpired reservation by the SAME
 * workspace is returned as-is (a second tab), never extended.
 */
export async function reserveTrialClaim(
  model: ClaimModel,
  input: { phoneHash: string; userId: unknown; businessId: unknown; now: Date }
): Promise<ReserveResult> {
  const { phoneHash, userId, businessId, now } = input;

  const existing = await model.findOne({ phoneHash }).lean<any>();
  if (existing?.status === 'reserved') {
    const sameHolder = String(existing.holderBusinessId) === String(businessId);
    const live = existing.reservedUntil && new Date(existing.reservedUntil).getTime() > now.getTime();
    if (sameHolder && live) return { ok: true, claim: existing, reused: true };
    if (!live) return { ok: false, reason: 'reservation_expired', claim: existing };
    return { ok: false, reason: 'phone_claimed' };
  }
  if (existing?.status === 'consumed') return { ok: false, reason: 'phone_claimed' };

  try {
    const claim = await model.findOneAndUpdate(
      { phoneHash, status: 'released' },
      {
        $set: {
          status: 'reserved',
          userId,
          businessId,
          holderBusinessId: businessId,
          reservedAt: now,
          reservedUntil: new Date(now.getTime() + TRIAL_RESERVATION_MS),
          needsReview: false,
        },
        $unset: { razorpaySubscriptionId: '', offer: '', consumedAt: '', releasedAt: '', releaseReason: '', subscriptionEndedAt: '' },
        $push: { history: { at: now, status: 'reserved', reason: 'checkout', businessId } },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean<any>();
    return { ok: true, claim, reused: false };
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern ?? err.keyValue ?? {});
      if (key.includes('holderBusinessId')) return { ok: false, reason: 'workspace_claimed' };
      // Lost a race on the phone — if the winner is this same workspace (two
      // tabs at once), share its reservation instead of refusing the trial.
      const winner = await model.findOne({ phoneHash }).lean<any>();
      const sameLiveHolder =
        winner?.status === 'reserved' &&
        String(winner.holderBusinessId) === String(businessId) &&
        new Date(winner.reservedUntil).getTime() > now.getTime();
      if (sameLiveHolder) return { ok: true, claim: winner, reused: true };
      return { ok: false, reason: 'phone_claimed' };
    }
    throw err;
  }
}

/**
 * Links the Razorpay subscription to the reservation. Succeeds once: a second
 * concurrent checkout for the same reservation gets null and must cancel the
 * subscription it just created instead of handing it to the browser.
 */
export async function attachSubscriptionToClaim(
  model: ClaimModel,
  input: {
    claimId: unknown;
    businessId: unknown;
    razorpaySubscriptionId: string;
    now: Date;
    /** The checkout's frozen offer terms — written in the same atomic update, never changed after. */
    offer?: Record<string, unknown>;
  }
): Promise<any | null> {
  return model.findOneAndUpdate(
    {
      _id: input.claimId,
      status: 'reserved',
      holderBusinessId: input.businessId,
      razorpaySubscriptionId: { $exists: false },
      reservedUntil: { $gt: input.now },
    },
    {
      $set: { razorpaySubscriptionId: input.razorpaySubscriptionId, ...(input.offer && { offer: input.offer }) },
      $push: { history: { at: input.now, status: 'reserved', reason: 'subscription_attached', razorpaySubscriptionId: input.razorpaySubscriptionId } },
    },
    { returnDocument: 'after' }
  ).lean<any>();
}

export type ConsumeResult =
  | { ok: true; claim: any; alreadyConsumed: boolean }
  | { ok: false; reason: 'not_owner' };

/**
 * Called on a verified authorization of a trial subscription. Only the
 * subscription the claim is attached to can consume it — a stale or second
 * subscription gets 'not_owner' and must not receive a trial. Replays are
 * harmless (alreadyConsumed).
 */
export async function consumeTrialClaim(
  model: ClaimModel,
  input: { razorpaySubscriptionId: string; now: Date }
): Promise<ConsumeResult> {
  const claim = await model.findOneAndUpdate(
    { razorpaySubscriptionId: input.razorpaySubscriptionId, status: 'reserved' },
    {
      $set: { status: 'consumed', consumedAt: input.now, needsReview: false },
      $push: { history: { at: input.now, status: 'consumed', reason: 'authorized', razorpaySubscriptionId: input.razorpaySubscriptionId } },
    },
    { returnDocument: 'after' }
  ).lean<any>();
  if (claim) return { ok: true, claim, alreadyConsumed: false };

  const consumed = await model
    .findOne({ razorpaySubscriptionId: input.razorpaySubscriptionId, status: 'consumed' })
    .lean<any>();
  if (consumed) return { ok: true, claim: consumed, alreadyConsumed: true };
  return { ok: false, reason: 'not_owner' };
}

async function releaseClaim(model: ClaimModel, claim: any, reason: string, now: Date) {
  return model.findOneAndUpdate(
    {
      _id: claim._id,
      status: 'reserved',
      razorpaySubscriptionId: claim.razorpaySubscriptionId ?? { $exists: false },
    },
    {
      $set: { status: 'released', releasedAt: now, releaseReason: reason },
      $unset: { holderBusinessId: '' },
      $push: { history: { at: now, status: 'released', reason, razorpaySubscriptionId: claim.razorpaySubscriptionId } },
    },
    { returnDocument: 'after' }
  ).lean<any>();
}

export interface SettleDeps {
  /** Razorpay subscription facts; throw or return 'unavailable' when Razorpay can't be reached. */
  fetchSubscription: (id: string) => Promise<RazorpaySubscriptionFacts | 'unavailable'>;
  /** Cancels a never-authorized subscription (Razorpay subscriptions.cancel). */
  cancelSubscription: (id: string) => Promise<void>;
}

/**
 * Decides what an expired reservation really is, by asking Razorpay — never
 * by the clock alone. Releases only when Razorpay confirms the subscription
 * can no longer be authorized; consumes when it was authorized but the
 * webhook hasn't arrived; leaves it reserved on any doubt.
 * Network calls happen outside any DB lock; each write is conditional on the
 * claim still being in the state it was read in.
 */
export async function settleTrialReservation(
  model: ClaimModel,
  claim: any,
  deps: SettleDeps,
  now: Date
): Promise<SettleAction> {
  const fetchFacts = async () => {
    if (!claim.razorpaySubscriptionId) return null;
    try {
      return await deps.fetchSubscription(claim.razorpaySubscriptionId);
    } catch {
      return 'unavailable' as const;
    }
  };

  let action = settleAction(claim, await fetchFacts(), now);
  if (action === 'cancel_then_recheck') {
    try {
      await deps.cancelSubscription(claim.razorpaySubscriptionId);
    } catch {
      // Already authorized/cancelled in between — the re-check below decides.
    }
    action = settleAction(claim, await fetchFacts(), now);
    if (action === 'cancel_then_recheck') action = 'keep';
  }

  if (action === 'release') {
    await releaseClaim(model, claim, claim.razorpaySubscriptionId ? 'checkout_not_authorized' : 'expired_without_subscription', now);
  } else if (action === 'consume') {
    await consumeTrialClaim(model, { razorpaySubscriptionId: claim.razorpaySubscriptionId, now });
  } else if (action === 'needs_review') {
    await model.updateOne({ _id: claim._id, status: 'reserved' }, { $set: { needsReview: true } });
  }
  return action;
}
