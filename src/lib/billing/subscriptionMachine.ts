/**
 * Razorpay subscription event → what the app is allowed to change. Pure (no
 * imports, no I/O) so every rule is unit-tested; the webhook and the
 * self-heal (razorpayReconcile.ts) both load facts, call decideBillingEvent(),
 * and execute the returned actions — they can't drift apart.
 *
 * Rules that matter most:
 *  - A trial subscription is NEVER paid until a captured `subscription.charged`
 *    for the exact snapshot amount. Razorpay sends `subscription.activated`
 *    with paid_count 0 when a future-start (trial) subscription's billing
 *    cycle starts, before any charge — that event grants nothing.
 *  - A trial starts only on `subscription.authenticated` for the subscription
 *    the phone's claim is attached to, matching the checkout snapshot.
 *  - Failures/cancellations only touch a workspace that currently has access
 *    through THIS subscription. A declined checkout (payment.failed) or an
 *    expired unpaid checkout never marks anyone past due or cancelled.
 *  - Events older than the last one applied are ignored (out-of-order delivery).
 */

export type BillingEventType =
  | 'subscription.authenticated'
  | 'subscription.activated'
  | 'subscription.charged'
  | 'subscription.pending'
  | 'subscription.halted'
  | 'subscription.cancelled'
  | 'subscription.completed'
  | 'subscription.expired'
  | 'payment.failed';

export interface SubscriptionFacts {
  id: string;
  status: string;
  planId: string | null;
  /** Unix seconds. */
  startAt: number | null;
  /** Unix seconds — end of the current paid period. */
  currentEnd: number | null;
  paidCount: number;
  /** notes.trial === '1', set by our checkout. */
  isTrial: boolean;
}

export interface PaymentFacts {
  amount: number | null;
  currency: string | null;
  status: string | null;
}

export interface WorkspaceFacts {
  id: string;
  subscriptionStatus: string | null;
  billingSubscriptionId: string | null;
  /** Legacy link written at checkout (may point at a newer, unpaid checkout). */
  razorpaySubscriptionId: string | null;
  trialEndsAt: Date | null;
  trialCancelledAt: Date | null;
  billingLastEventAt: Date | null;
  /** Originals replaced by a recovery checkout (cancelled on purpose). */
  supersededSubscriptionIds?: string[];
}

export interface ClaimFacts {
  status: 'reserved' | 'consumed' | 'released';
  businessId: string;
  attachedSubscriptionId: string | null;
  offer: { razorpayPlanId: string; amountPaise: number; currency: string; trialEndsAt: Date } | null;
}

export type BillingAction =
  | { kind: 'start_trial'; trialEndsAt: Date }
  | { kind: 'consume_claim' }
  | { kind: 'reject_trial'; reason: string }
  | { kind: 'activate_paid'; periodEnd: Date | null; renewal: boolean }
  | { kind: 'payment_failed'; halted: boolean; reason: string }
  | { kind: 'trial_cancelled' }
  | { kind: 'cancel_paid' }
  | { kind: 'settle_claim' }
  | { kind: 'lead_payment_failed' };

export interface BillingDecision {
  actions: BillingAction[];
  /** Stamp billingLastEventAt with this event's time (only for applied state changes). */
  recordEvent: boolean;
  /** Why nothing (or this) happened — for logs and the audit trail. */
  note: string;
}

const ignore = (note: string): BillingDecision => ({ actions: [], recordEvent: false, note });

const HAS_ACCESS = new Set(['active', 'trial_active', 'past_due']);

/** True when this subscription is the one granting the workspace its access. */
export function isBillingSubscription(ws: WorkspaceFacts, subId: string): boolean {
  if (ws.billingSubscriptionId) return ws.billingSubscriptionId === subId;
  // Legacy paid workspaces (activated before billingSubscriptionId existed)
  // only have the checkout link — same behaviour as before this change.
  return !ws.razorpaySubscriptionId || ws.razorpaySubscriptionId === subId;
}

function isStale(ws: WorkspaceFacts, eventAt: Date): boolean {
  return !!ws.billingLastEventAt && eventAt.getTime() < ws.billingLastEventAt.getTime();
}

export function decideBillingEvent(input: {
  type: BillingEventType | string;
  eventAt: Date;
  sub: SubscriptionFacts | null;
  payment: PaymentFacts | null;
  workspace: WorkspaceFacts | null;
  claim: ClaimFacts | null;
  /** Expected charge for a NON-trial subscription's plan, when we know it (paise). */
  expectedPaidAmountPaise: number | null;
  /** Facts fetched from Razorpay just now (self-heal) — current truth, so no staleness check. */
  authoritative?: boolean;
}): BillingDecision {
  const { type, eventAt, sub, payment, workspace: ws, claim } = input;
  const stale = (w: WorkspaceFacts) => !input.authoritative && isStale(w, eventAt);

  if (type === 'payment.failed') {
    // A declined attempt — in the checkout window or on a recurring charge.
    // Recurring failures also arrive as subscription.pending/halted, which is
    // where access changes. This only moves the CRM lead stage.
    return { actions: [{ kind: 'lead_payment_failed' }], recordEvent: false, note: 'payment attempt failed (no access change)' };
  }

  if (!sub) return ignore('no subscription in payload');
  if (!ws) return ignore('workspace not resolved');

  const linked = isBillingSubscription(ws, sub.id);
  const status = ws.subscriptionStatus ?? 'trialing';
  // We cancelled this one ourselves to replace it (safe recovery): its
  // failures and cancellation must not fail or cancel the workspace. A
  // charge on it still counts (it was paid after all).
  const superseded = (ws.supersededSubscriptionIds ?? []).includes(sub.id);

  switch (type) {
    case 'subscription.authenticated': {
      if (!sub.isTrial) return ignore('non-trial authentication (first charge follows as activated/charged)');
      if (!claim || claim.attachedSubscriptionId !== sub.id) {
        return { actions: [{ kind: 'reject_trial', reason: 'not the claim owner' }], recordEvent: false, note: 'trial authorized for a subscription that does not own the phone claim' };
      }
      if (claim.businessId !== ws.id) {
        return { actions: [{ kind: 'reject_trial', reason: 'claim belongs to another workspace' }], recordEvent: false, note: 'workspace mismatch' };
      }
      if (claim.status === 'released') {
        return { actions: [{ kind: 'reject_trial', reason: 'claim released' }], recordEvent: false, note: 'claim was released' };
      }
      const offer = claim.offer;
      const startMatches = !!offer && sub.startAt === Math.floor(offer.trialEndsAt.getTime() / 1000);
      if (!offer || offer.razorpayPlanId !== sub.planId || !startMatches) {
        return { actions: [{ kind: 'reject_trial', reason: 'subscription does not match the checkout snapshot' }], recordEvent: false, note: 'snapshot mismatch' };
      }
      if (status === 'active') {
        return { actions: [{ kind: 'reject_trial', reason: 'workspace already paid' }], recordEvent: false, note: 'workspace already paid' };
      }
      if (status === 'trial_active' && ws.billingSubscriptionId === sub.id) {
        return { actions: [{ kind: 'consume_claim' }], recordEvent: false, note: 'trial already started (replay)' };
      }
      return {
        actions: [{ kind: 'consume_claim' }, { kind: 'start_trial', trialEndsAt: offer.trialEndsAt }],
        recordEvent: true,
        note: 'trial authorized',
      };
    }

    case 'subscription.activated':
    case 'subscription.charged': {
      if (stale(ws) && linked) return ignore('older than the last applied event');
      const captured = payment?.status === 'captured';
      if (sub.isTrial) {
        // activated = billing cycle started (paid_count 0 for a trial) — not payment.
        if (type === 'subscription.activated' && !captured) return ignore('trial billing cycle started; waiting for the charge');
        if (!captured) return ignore('no captured payment');
        const expected = claim?.attachedSubscriptionId === sub.id ? claim.offer : null;
        if (!expected) return ignore('trial charge without a matching checkout snapshot — not activating');
        if (payment!.currency !== expected.currency) return ignore(`currency mismatch (${payment!.currency})`);
        if (payment!.amount !== expected.amountPaise) return ignore(`amount mismatch (${payment!.amount} ≠ ${expected.amountPaise})`);
      } else {
        // Non-trial: the authorization payment IS the first charge.
        if (!captured && sub.paidCount < 1) return ignore('no payment yet');
        if (captured && payment!.currency && payment!.currency !== 'INR') return ignore(`currency mismatch (${payment!.currency})`);
        if (captured && input.expectedPaidAmountPaise != null && payment!.amount !== input.expectedPaidAmountPaise) {
          return ignore(`amount mismatch (${payment!.amount} ≠ ${input.expectedPaidAmountPaise})`);
        }
      }
      return {
        actions: [{
          kind: 'activate_paid',
          periodEnd: sub.currentEnd ? new Date(sub.currentEnd * 1000) : null,
          renewal: type === 'subscription.charged' && status === 'active',
        }],
        recordEvent: true,
        note: sub.isTrial ? 'trial converted to paid' : 'payment verified',
      };
    }

    case 'subscription.pending':
    case 'subscription.halted': {
      if (superseded) return ignore('superseded by a recovery checkout');
      if (!linked) return ignore('not the subscription granting access');
      if (!HAS_ACCESS.has(status)) return ignore(`workspace is ${status} — nothing to fail`);
      if (stale(ws)) return ignore('older than the last applied event');
      return {
        actions: [{ kind: 'payment_failed', halted: type === 'subscription.halted', reason: type === 'subscription.halted' ? 'retries_exhausted' : 'charge_failed' }],
        recordEvent: true,
        note: 'charge failed',
      };
    }

    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired': {
      if (sub.isTrial && claim?.status === 'reserved' && claim.attachedSubscriptionId === sub.id) {
        // Never authorized — ask Razorpay before the phone's claim is released.
        return { actions: [{ kind: 'settle_claim' }], recordEvent: false, note: 'unauthorized trial checkout ended' };
      }
      if (superseded) return ignore('superseded by a recovery checkout (cancelled on purpose)');
      if (!linked) return ignore('not the subscription granting access');
      if (stale(ws)) return ignore('older than the last applied event');
      if (status === 'trial_active') {
        return { actions: [{ kind: 'trial_cancelled' }], recordEvent: true, note: 'trial cancelled — access until trial end, no charge' };
      }
      if (status === 'active' || status === 'past_due') {
        return { actions: [{ kind: 'cancel_paid' }], recordEvent: true, note: 'subscription ended' };
      }
      return ignore(`workspace is ${status} — nothing to cancel`);
    }

    default:
      return ignore(`unhandled event ${type}`);
  }
}

/** Razorpay's subscription entity (webhook payload or API fetch) → facts. */
export function subscriptionFactsFrom(entity: any): SubscriptionFacts | null {
  if (!entity?.id) return null;
  return {
    id: String(entity.id),
    status: String(entity.status ?? ''),
    planId: entity.plan_id ? String(entity.plan_id) : null,
    startAt: typeof entity.start_at === 'number' ? entity.start_at : null,
    currentEnd: typeof entity.current_end === 'number' ? entity.current_end : null,
    paidCount: Number(entity.paid_count ?? 0),
    isTrial: entity?.notes?.trial === '1',
  };
}

export function paymentFactsFrom(entity: any): PaymentFacts | null {
  if (!entity) return null;
  return {
    amount: typeof entity.amount === 'number' ? entity.amount : null,
    currency: entity.currency ? String(entity.currency) : null,
    status: entity.status ? String(entity.status) : null,
  };
}

/**
 * The same rules applied to a subscription fetched from Razorpay (self-heal
 * when a webhook is late or lost): which event its current state implies.
 */
export function impliedEventFromState(sub: SubscriptionFacts): BillingEventType | null {
  if (sub.isTrial && sub.status === 'authenticated') return 'subscription.authenticated';
  if (sub.paidCount > 0 && (sub.status === 'active' || sub.status === 'authenticated')) return 'subscription.charged';
  if (sub.status === 'pending') return 'subscription.pending';
  if (sub.status === 'halted') return 'subscription.halted';
  if (sub.status === 'cancelled') return 'subscription.cancelled';
  if (sub.status === 'expired') return 'subscription.expired';
  if (sub.status === 'completed') return 'subscription.completed';
  return null;
}
