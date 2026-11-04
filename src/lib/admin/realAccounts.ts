import Business from '@/models/Business';

/**
 * Super-admin lists hide UNCLAIMED shadow accounts (created by the free
 * report — src/lib/shadowAccount.ts) so lead-gen traffic doesn't inflate
 * customer numbers. The shadow flag is never cleared when that person later
 * starts a trial or pays, so a shadow account that owns a workspace on a
 * paid plan, a free trial or a failed payment is a real customer and must be
 * listed. Decided at read time from Business.subscriptionStatus — no data
 * migration.
 */
export const CUSTOMER_STATUSES = ['active', 'trial_active', 'past_due'] as const;

/** Users who own a paid / trial / past-due workspace. */
export async function customerUserIds(): Promise<unknown[]> {
  return Business.distinct('userId', { subscriptionStatus: { $in: [...CUSTOMER_STATUSES] }, isDeleted: { $ne: true } });
}

/** User filter: real sign-ups, plus shadow accounts that became customers. */
export async function realUserFilter(): Promise<Record<string, unknown>> {
  const ids = await customerUserIds();
  return { $or: [{ isShadowAccount: { $ne: true } }, { _id: { $in: ids } }] };
}

/** Business filter: normally created workspaces, plus free-report ones now on a plan or trial. */
export function realBusinessFilter(): Record<string, unknown> {
  return { $or: [{ provisionedVia: { $exists: false } }, { subscriptionStatus: { $in: [...CUSTOMER_STATUSES] } }] };
}

/** "Paid" / "Free trial" / "Payment failed" / null for a workspace status. */
export function workspacePlanLabel(status: string | null | undefined): string | null {
  return status === 'active' ? 'Paid' : status === 'trial_active' ? 'Free trial' : status === 'past_due' ? 'Payment failed' : null;
}
