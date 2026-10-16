/**
 * Old Subscription records that say billingStatus 'Trialing' without
 * trialSource 'offer' come from the schema's former default (a 14-day
 * "trial" written by any upsert, e.g. opening checkout). They never were a
 * real trial. requireModule / mobile no longer honour them; this classifies
 * them for the one-off cleanup (scripts/cleanup-legacy-trialing.ts). Pure.
 */

export type LegacyTrialCategory =
  /** Was still unlocking paid modules under the old rule (isActive, not expired). */
  | 'was_granting_access'
  /** Already expired — harmless, just wrong data. */
  | 'expired'
  /** The account is a paying customer — left alone, reported for manual review. */
  | 'paying_customer_skip';

export interface LegacyTrialRecord {
  billingStatus?: string | null;
  trialSource?: string | null;
  trialStatus?: { isActive?: boolean | null; endsAt?: Date | string | null } | null;
}

export function isLegacyDefaultTrial(sub: LegacyTrialRecord): boolean {
  return sub.billingStatus === 'Trialing' && sub.trialSource !== 'offer';
}

export function classifyLegacyTrial(
  sub: LegacyTrialRecord,
  owner: { subscriptionPlan?: string | null; hasActiveWorkspace: boolean },
  now: Date
): LegacyTrialCategory {
  if ((owner.subscriptionPlan && owner.subscriptionPlan !== 'Free') || owner.hasActiveWorkspace) return 'paying_customer_skip';
  const endsAt = sub.trialStatus?.endsAt ? new Date(sub.trialStatus.endsAt).getTime() : null;
  const live = !!sub.trialStatus?.isActive && (endsAt === null || endsAt > now.getTime());
  return live ? 'was_granting_access' : 'expired';
}

/** The fix for a non-paying record: a plain free subscription (planType and modules untouched). */
export const LEGACY_TRIAL_FIX = { billingStatus: 'Active', 'trialStatus.isActive': false } as const;
