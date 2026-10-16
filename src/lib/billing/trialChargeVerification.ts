/**
 * A free trial's first charge that Razorpay has NOT confirmed after the
 * processing window — distinguished from a confirmed failure (pending/halted,
 * applied by the webhook / self-heal). Never treated as paid or as failed:
 * re-checked on every run, flagged once for a person to review. Pure, no imports.
 */

export interface VerificationCheck {
  attempted: boolean;
  activated: boolean;
  razorpayStatus?: string;
  reason?: string;
}

export const UNCONFIRMED_TRIAL_EVENT = 'trial.charge_unconfirmed';

/** Why the charge is still unconfirmed — for the review queue. */
export function unconfirmedTrialNote(check: VerificationCheck | null | undefined): string {
  if (!check || !check.razorpayStatus) {
    return `first charge not confirmed: Razorpay could not be checked (${check?.reason ?? 'no answer'}) — re-checking; not treated as paid or failed`;
  }
  return `first charge not confirmed: Razorpay reports "${check.razorpayStatus}"${check.reason ? ` (${check.reason})` : ''} — re-checking; not treated as paid or failed`;
}

/** Flag only once per open (unreviewed) case — the daily re-check must not flood the queue. */
export function shouldFlagUnconfirmed(openFlag: { reviewedAt?: Date | null } | null | undefined): boolean {
  return !openFlag || !!openFlag.reviewedAt;
}
