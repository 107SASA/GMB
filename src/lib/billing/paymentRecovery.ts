import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';

/**
 * Safe recovery checkout after a failed payment — never two subscriptions
 * that can both charge the same workspace.
 *
 * A past-due workspace still has its original Razorpay subscription, which
 * Razorpay may keep retrying (pending) or which the customer can retry
 * (halted). Creating a second subscription next to it risks a double charge.
 * So, in order:
 *   1. Take the workspace's recovery lock (atomic; one request at a time).
 *   2. Reuse an existing, still-open recovery checkout (repeated clicks).
 *   3. Ask Razorpay about the original. Paid after all → reconcile, done,
 *      never cancel it. Can still charge → mark it superseded (so its own
 *      cancellation/failure events can't touch the workspace), cancel it, ask
 *      again, and only continue if Razorpay confirms it can no longer charge
 *      and nothing was paid in between.
 *   4. Create the replacement (no trial — recovery never grants one).
 * Any doubt (Razorpay unreachable, unknown status, cancellation unconfirmed)
 * creates nothing and is recorded for admin review.
 *
 * No `@/` imports and Razorpay passed in, so tests run it against a real
 * MongoDB with a fake Razorpay.
 */

export const RECOVERY_LOCK_MS = 60_000;
/** A recovery checkout must be paid within this window (Razorpay expire_by). */
export const RECOVERY_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

const TERMINAL = new Set(['cancelled', 'completed', 'expired']);
const CAN_STILL_CHARGE = new Set(['created', 'authenticated', 'pending', 'halted', 'paused']);

export interface RazorpaySubState {
  status: string;
  paidCount: number;
}

export type OriginalDecision = 'already_paid' | 'cancel_then_verify' | 'cannot_charge' | 'unknown';

/** What to do with the original subscription, from Razorpay's own answer. */
export function decideOriginal(state: RazorpaySubState): OriginalDecision {
  if (state.status === 'active') return 'already_paid';
  if (TERMINAL.has(state.status)) return 'cannot_charge';
  if (CAN_STILL_CHARGE.has(state.status)) return 'cancel_then_verify';
  return 'unknown';
}

/** After our cancel: safe to replace only if it can't charge AND nothing was paid meanwhile. */
export function decideAfterCancel(before: RazorpaySubState, after: RazorpaySubState): 'proceed' | 'already_paid' | 'unconfirmed' {
  if (after.paidCount > before.paidCount || after.status === 'active') return 'already_paid';
  if (TERMINAL.has(after.status)) return 'proceed';
  return 'unconfirmed';
}

export interface RecoveryDeps {
  Business: Model<any>;
  fetchSubscription: (id: string) => Promise<RazorpaySubState>;
  cancelSubscription: (id: string) => Promise<void>;
  createSubscription: (input: { businessId: string; userId: string; cycle: string; replaces: string | null; expireBy: Date }) => Promise<{ id: string }>;
  /** Apply Razorpay's current state for a subscription that turned out to be paid. */
  reconcilePaid: (businessId: string, subscriptionId: string) => Promise<void>;
  record: (entry: { businessId: string; type: string; note: string; subscriptionId?: string; needsReview?: boolean }) => Promise<void>;
  now: () => Date;
}

export type RecoveryResult =
  | { kind: 'checkout'; subscriptionId: string; reused: boolean }
  | { kind: 'already_paid' }
  | { kind: 'not_needed' }
  | { kind: 'busy' }
  | { kind: 'unavailable'; reason: string };

export async function prepareRecoveryCheckout(
  deps: RecoveryDeps,
  input: { businessId: string; userId: string; cycle: string }
): Promise<RecoveryResult> {
  const { Business } = deps;
  const businessId = input.businessId;
  const ws = await Business.findById(businessId)
    .select('subscriptionStatus billingSubscriptionId razorpaySubscriptionId recoveryCheckout supersededSubscriptionIds')
    .lean<any>();
  if (!ws || ws.subscriptionStatus !== 'past_due') return { kind: 'not_needed' };

  // 1. Lock — repeated clicks / concurrent tabs / retries: one at a time.
  const token = randomUUID();
  const now = deps.now();
  const locked = await Business.findOneAndUpdate(
    { _id: businessId, $or: [{ recoveryLock: { $exists: false } }, { 'recoveryLock.until': { $lt: now } }] },
    { $set: { recoveryLock: { token, until: new Date(now.getTime() + RECOVERY_LOCK_MS) } } },
    { returnDocument: 'after' }
  )
    .select('subscriptionStatus billingSubscriptionId razorpaySubscriptionId recoveryCheckout supersededSubscriptionIds')
    .lean<any>();
  if (!locked) return { kind: 'busy' };

  const unavailable = async (reason: string, note: string, subscriptionId?: string): Promise<RecoveryResult> => {
    await deps.record({ businessId, type: 'recovery.blocked', note: `${reason}: ${note}`, subscriptionId, needsReview: true });
    return { kind: 'unavailable', reason };
  };

  try {
    if (locked.subscriptionStatus !== 'past_due') return { kind: 'not_needed' };

    // 2. An open recovery checkout from an earlier click → hand back the same one.
    const open = locked.recoveryCheckout;
    if (open?.subscriptionId && new Date(open.expiresAt).getTime() > deps.now().getTime()) {
      let state: RazorpaySubState;
      try {
        state = await deps.fetchSubscription(open.subscriptionId);
      } catch (err: any) {
        return unavailable('razorpay_unreachable', `recovery checkout ${open.subscriptionId}: ${err?.message ?? err}`, open.subscriptionId);
      }
      if (state.status === 'created') return { kind: 'checkout', subscriptionId: open.subscriptionId, reused: true };
      if (state.status === 'active' || state.paidCount > 0) {
        await deps.reconcilePaid(businessId, open.subscriptionId);
        return { kind: 'already_paid' };
      }
      if (!TERMINAL.has(state.status)) {
        return unavailable('ambiguous_status', `recovery checkout ${open.subscriptionId} is "${state.status}"`, open.subscriptionId);
      }
      await Business.updateOne({ _id: businessId }, { $unset: { recoveryCheckout: '' } });
    }

    // 3. The original subscription.
    const original: string | null = locked.billingSubscriptionId || locked.razorpaySubscriptionId || null;
    const superseded: string[] = locked.supersededSubscriptionIds ?? [];
    if (original && original !== open?.subscriptionId && !superseded.includes(original)) {
      let before: RazorpaySubState;
      try {
        before = await deps.fetchSubscription(original);
      } catch (err: any) {
        return unavailable('razorpay_unreachable', `original ${original}: ${err?.message ?? err}`, original);
      }
      const decision = decideOriginal(before);
      if (decision === 'already_paid') {
        // Razorpay's retry succeeded — never cancel a paid subscription.
        await deps.reconcilePaid(businessId, original);
        await deps.record({ businessId, type: 'recovery.original_paid', note: 'original subscription is active — reconciled, nothing cancelled', subscriptionId: original });
        return { kind: 'already_paid' };
      }
      if (decision === 'unknown') return unavailable('ambiguous_status', `original ${original} is "${before.status}"`, original);

      // Mark superseded BEFORE cancelling: the cancellation webhook for it
      // must not cancel the workspace (see subscriptionMachine.ts).
      await Business.updateOne({ _id: businessId }, { $addToSet: { supersededSubscriptionIds: original } });
      if (decision === 'cancel_then_verify') {
        try {
          await deps.cancelSubscription(original);
        } catch {
          // Already cancelled/expired, or a concurrent change — the re-check decides.
        }
        let after: RazorpaySubState;
        try {
          after = await deps.fetchSubscription(original);
        } catch (err: any) {
          await Business.updateOne({ _id: businessId }, { $pull: { supersededSubscriptionIds: original } });
          return unavailable('cancel_unconfirmed', `original ${original}: re-check failed (${err?.message ?? err})`, original);
        }
        const verdict = decideAfterCancel(before, after);
        if (verdict === 'already_paid') {
          await Business.updateOne({ _id: businessId }, { $pull: { supersededSubscriptionIds: original } });
          await deps.reconcilePaid(businessId, original);
          await deps.record({ businessId, type: 'recovery.original_paid', note: 'original was charged while cancelling — reconciled, no replacement', subscriptionId: original, needsReview: true });
          return { kind: 'already_paid' };
        }
        if (verdict === 'unconfirmed') {
          await Business.updateOne({ _id: businessId }, { $pull: { supersededSubscriptionIds: original } });
          return unavailable('cancel_unconfirmed', `original ${original} still "${after.status}" after cancel`, original);
        }
        await deps.record({ businessId, type: 'recovery.original_cancelled', note: `original was "${before.status}" — cancelled and verified "${after.status}"`, subscriptionId: original });
      }
    }

    // 4. Replacement — the normal paid plan, never a trial.
    const expireBy = new Date(deps.now().getTime() + RECOVERY_CHECKOUT_TTL_MS);
    let created: { id: string };
    try {
      created = await deps.createSubscription({ businessId, userId: input.userId, cycle: input.cycle, replaces: original, expireBy });
    } catch (err: any) {
      return unavailable('create_failed', String(err?.message ?? err), original ?? undefined);
    }
    await Business.updateOne(
      { _id: businessId },
      {
        $set: {
          razorpaySubscriptionId: created.id,
          recoveryCheckout: { subscriptionId: created.id, replacesSubscriptionId: original, cycle: input.cycle, createdAt: deps.now(), expiresAt: expireBy },
        },
      }
    );
    await deps.record({ businessId, type: 'recovery.checkout_created', note: `replacement for ${original ?? 'none'} (${input.cycle})`, subscriptionId: created.id });
    return { kind: 'checkout', subscriptionId: created.id, reused: false };
  } finally {
    await Business.updateOne({ _id: businessId, 'recoveryLock.token': token }, { $unset: { recoveryLock: '' } });
  }
}
