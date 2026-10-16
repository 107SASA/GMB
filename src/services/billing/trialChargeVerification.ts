import dbConnect from '@/lib/mongodb';
import BillingEvent from '@/models/BillingEvent';
import {
  UNCONFIRMED_TRIAL_EVENT,
  shouldFlagUnconfirmed,
  unconfirmedTrialNote,
  type VerificationCheck,
} from '@/lib/billing/trialChargeVerification';

/**
 * Records — once per open case — that a trial's first charge is still not
 * confirmed by Razorpay, in the Super Admin review queue (BillingEvent
 * needsReview). Changes no access, status, reminder or message.
 */
export async function flagUnconfirmedTrialCharge(
  businessId: string,
  userId: string | null,
  check: VerificationCheck | null
): Promise<boolean> {
  await dbConnect();
  const open = await BillingEvent.findOne({ businessId, eventType: UNCONFIRMED_TRIAL_EVENT, needsReview: true, reviewedAt: { $exists: false } })
    .select('reviewedAt')
    .lean<{ reviewedAt?: Date } | null>();
  if (!shouldFlagUnconfirmed(open)) return false;
  const note = unconfirmedTrialNote(check);
  await BillingEvent.create({
    businessId,
    userId: userId ?? undefined,
    eventType: UNCONFIRMED_TRIAL_EVENT,
    source: 'reconcile',
    eventAt: new Date(),
    statusBefore: 'trial_active',
    statusAfter: 'trial_active',
    actions: [],
    note,
    needsReview: true,
  });
  console.error(`[billing] NEEDS REVIEW business ${businessId}: ${note}`);
  return true;
}
