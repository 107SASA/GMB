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
  return {
    $or: [
      { provisionedVia: { $exists: false } },
      { subscriptionStatus: { $in: [...CUSTOMER_STATUSES] } },
      // Free accounts created in the app / on the website are real, OTP-verified
      // sign-ups (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md) — not lead-gen traffic.
      { provisionedVia: { $in: [...FREE_SIGNUP_SOURCES] } },
    ],
  };
}

/** provisionedVia of free-account sign-ups (services/auth/freeAccount.ts). */
export const FREE_SIGNUP_SOURCES = ['app-signup', 'website-signup'] as const;

/** "Paid" / "Free trial" / "Payment failed" / "Free CRM" (any other status) for a workspace. */
export function workspacePlanLabel(status: string | null | undefined): string | null {
  if (status === 'active') return 'Paid';
  if (status === 'trial_active') return 'Free trial';
  if (status === 'past_due') return 'Payment failed';
  // Every other listed workspace is on the Free CRM tier (CRM + card scan, lib/freeCrm.ts).
  return status === 'canceled' ? 'Cancelled · Free CRM' : 'Free CRM';
}

/**
 * The owner's most significant workspace: paid, then trial, then past due,
 * then any. Shared by the Customers list and the customer detail page so they
 * always show the same business.
 */
export function primaryBusinessByOwner<T extends { userId?: unknown; subscriptionStatus?: string }>(businesses: T[]): Record<string, T> {
  const rank = (s?: string) => { const i = (CUSTOMER_STATUSES as readonly string[]).indexOf(s || ''); return i === -1 ? 9 : i; };
  const map: Record<string, T> = {};
  for (const b of businesses) {
    if (!b.userId) continue;
    const k = String(b.userId);
    if (!map[k] || rank(b.subscriptionStatus) < rank(map[k].subscriptionStatus)) map[k] = b;
  }
  return map;
}
