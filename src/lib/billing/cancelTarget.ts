/**
 * Which Razorpay subscription "Cancel subscription" must cancel for a
 * workspace — the one PAYING for it, never the user-level
 * Subscription.razorpaySubscriptionId (checkout overwrites that with the
 * newest, possibly unpaid, checkout of ANY of the owner's workspaces).
 * Pure, no imports.
 */

export interface CancelWorkspaceFacts {
  subscriptionStatus?: string | null;
  billingSubscriptionId?: string | null;
  /** Checkout link; for a legacy paid workspace (no billingSubscriptionId) it is the paid subscription. */
  razorpaySubscriptionId?: string | null;
  trialCancelledAt?: Date | string | null;
}

export type CancelTarget =
  | { kind: 'trial'; subscriptionId: string; alreadyCancelled: boolean }
  | { kind: 'paid'; subscriptionId: string }
  | { kind: 'none' };

const CANCELLABLE_PAID = new Set(['active', 'past_due']);

export function cancelTarget(ws: CancelWorkspaceFacts | null | undefined): CancelTarget {
  if (!ws) return { kind: 'none' };
  if (ws.subscriptionStatus === 'trial_active') {
    return ws.billingSubscriptionId
      ? { kind: 'trial', subscriptionId: ws.billingSubscriptionId, alreadyCancelled: !!ws.trialCancelledAt }
      : { kind: 'none' };
  }
  if (!CANCELLABLE_PAID.has(ws.subscriptionStatus ?? '')) return { kind: 'none' };
  const paying = ws.billingSubscriptionId || (ws.subscriptionStatus === 'active' ? ws.razorpaySubscriptionId : null);
  return paying ? { kind: 'paid', subscriptionId: paying } : { kind: 'none' };
}

/**
 * The workspace the request is about: the explicitly selected one (header /
 * cookie) when given; otherwise — older clients that send none — the owner's
 * only workspace with something to cancel. More than one → ask (never guess).
 */
export function pickCancelWorkspace<T extends CancelWorkspaceFacts & { _id: unknown }>(
  owned: T[],
  selectedId: string | null
): { ok: true; workspace: T } | { ok: false; reason: 'not_owner' | 'none' | 'ambiguous' } {
  if (selectedId) {
    const ws = owned.find((b) => String(b._id) === selectedId);
    return ws ? { ok: true, workspace: ws } : { ok: false, reason: 'not_owner' };
  }
  const candidates = owned.filter((b) => cancelTarget(b).kind !== 'none');
  if (candidates.length === 1) return { ok: true, workspace: candidates[0] };
  return { ok: false, reason: candidates.length === 0 ? 'none' : 'ambiguous' };
}
