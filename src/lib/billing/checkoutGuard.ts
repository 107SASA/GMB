/**
 * Before checkout creates a NEW Razorpay subscription for a workspace, the
 * workspace's previous unpaid checkout (Business.razorpaySubscriptionId when
 * it is not the subscription granting access) must not be able to charge too —
 * a customer who pays, sees "activation is taking longer" and pays again would
 * otherwise hold two subscriptions that both bill the workspace.
 *
 * Asks Razorpay, never the clock:
 *  - never authorized ('created')         → cancel it, confirm it is cancelled, continue
 *  - already over (cancelled/expired/…)   → continue
 *  - authorized or paid (a payment is in flight / its webhook is late)
 *                                          → refuse; the caller reconciles it
 *  - unreachable / unknown / unconfirmed  → refuse (nothing is created on doubt)
 *
 * Pure (Razorpay passed in, no `@/` imports) so tests drive it with a fake.
 */

export interface PreviousCheckoutState {
  status: string;
  paidCount: number;
}

export interface CheckoutGuardDeps {
  fetchSubscription: (id: string) => Promise<PreviousCheckoutState>;
  cancelSubscription: (id: string) => Promise<void>;
}

export type CheckoutGuardResult =
  | { kind: 'clear' }
  | { kind: 'cancelled_previous'; subscriptionId: string }
  | { kind: 'payment_in_progress'; subscriptionId: string; status: string }
  | { kind: 'unavailable'; subscriptionId: string; reason: string };

const OVER = new Set(['cancelled', 'expired', 'completed']);
const AUTHORIZED = new Set(['authenticated', 'active', 'pending', 'halted', 'paused']);

export type TrialReuseDecision = 'reuse' | 'payment_in_progress' | 'ended' | 'unknown';

/**
 * A second tab / retry of a trial checkout gets the subscription already
 * attached to the reservation — but only while Razorpay says it can still be
 * authorized. A cancelled/expired one is never handed back (the payment window
 * would fail); an authorized one means the trial is being set up already.
 */
export function decideTrialCheckoutReuse(state: PreviousCheckoutState): TrialReuseDecision {
  if (state.status === 'created' && state.paidCount === 0) return 'reuse';
  if (AUTHORIZED.has(state.status) || state.paidCount > 0) return 'payment_in_progress';
  if (OVER.has(state.status)) return 'ended';
  return 'unknown';
}

/** Which earlier checkout, if any, must be dealt with before a new subscription is created. */
export function previousUnpaidCheckout(ws: {
  subscriptionStatus?: string | null;
  razorpaySubscriptionId?: string | null;
  billingSubscriptionId?: string | null;
} | null | undefined): string | null {
  const previous = ws?.razorpaySubscriptionId;
  if (!previous) return null;
  // The subscription granting (or that granted) access is not an abandoned checkout.
  if (previous === ws?.billingSubscriptionId) return null;
  // Legacy paid workspace (before billingSubscriptionId): its link IS the paid subscription.
  if (ws?.subscriptionStatus === 'active' && !ws?.billingSubscriptionId) return null;
  return previous;
}

export async function retirePreviousCheckout(deps: CheckoutGuardDeps, previousId: string | null): Promise<CheckoutGuardResult> {
  if (!previousId) return { kind: 'clear' };

  let before: PreviousCheckoutState;
  try {
    before = await deps.fetchSubscription(previousId);
  } catch (err: any) {
    return { kind: 'unavailable', subscriptionId: previousId, reason: `fetch failed: ${err?.message ?? err}` };
  }
  // A finished subscription can never charge again (whatever it was paid before).
  if (OVER.has(before.status)) return { kind: 'clear' };
  if (AUTHORIZED.has(before.status) || before.paidCount > 0) {
    return { kind: 'payment_in_progress', subscriptionId: previousId, status: before.status };
  }
  if (before.status !== 'created') {
    return { kind: 'unavailable', subscriptionId: previousId, reason: `unknown status "${before.status}"` };
  }

  try {
    await deps.cancelSubscription(previousId);
  } catch {
    // Authorized or cancelled in between — the re-check decides.
  }
  let after: PreviousCheckoutState;
  try {
    after = await deps.fetchSubscription(previousId);
  } catch (err: any) {
    return { kind: 'unavailable', subscriptionId: previousId, reason: `re-check failed: ${err?.message ?? err}` };
  }
  // Paid between our two reads — never treat that as cancelled.
  if (AUTHORIZED.has(after.status) || after.paidCount > before.paidCount) {
    return { kind: 'payment_in_progress', subscriptionId: previousId, status: after.status };
  }
  if (OVER.has(after.status)) return { kind: 'cancelled_previous', subscriptionId: previousId };
  return { kind: 'unavailable', subscriptionId: previousId, reason: `still "${after.status}" after cancel` };
}
