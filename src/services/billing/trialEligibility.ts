import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import TrialClaim from '@/models/TrialClaim';
import { trialPhoneKey } from '@/lib/phone';
import { getRazorpay } from '@/lib/billing/razorpay';
import {
  trialEligibility,
  trialPhoneHash,
  reserveTrialClaim,
  settleTrialReservation,
  type RazorpaySubscriptionFacts,
  type SettleDeps,
  type TrialIneligibleReason,
} from '@/lib/billing/trialClaims';

/**
 * Server-side gate for the one-free-trial-per-verified-phone rule. Checkout
 * calls reserveTrialForCheckout() before creating any Razorpay subscription;
 * anything other than { trial: true } means the normal paid checkout.
 * Never reads anything the browser sent.
 */

export type TrialDenyReason =
  | TrialIneligibleReason
  | 'user_not_found'
  | 'workspace_not_found'
  | 'phone_claimed'
  | 'workspace_claimed'
  | 'reservation_unresolved';

/** Every stored format the same phone number may have been saved in (exact matches, never a suffix match). */
function storedPhoneVariants(phoneKey: string): string[] {
  const variants = new Set([phoneKey, phoneKey.slice(1)]);
  if (phoneKey.startsWith('+91')) {
    const national = phoneKey.slice(3);
    variants.add(national);
    variants.add(`0${national}`);
  }
  return [...variants];
}

export async function checkTrialEligibility(
  userId: string,
  businessId: string
): Promise<{ eligible: true; phoneKey: string } | { eligible: false; reason: TrialDenyReason }> {
  await dbConnect();
  const [user, workspace] = await Promise.all([
    User.findById(userId).select('phone isPhoneVerified').lean<{ phone?: string; isPhoneVerified?: boolean }>(),
    Business.findById(businessId)
      .select('subscriptionStatus subscriptionCurrentPeriodEnd trialStartedAt')
      .lean<{ subscriptionStatus?: string; subscriptionCurrentPeriodEnd?: Date; trialStartedAt?: Date }>(),
  ]);
  if (!user) return { eligible: false, reason: 'user_not_found' };
  if (!workspace) return { eligible: false, reason: 'workspace_not_found' };

  const phoneKey = trialPhoneKey(user.phone);
  let phonePaid = { userPlans: [] as string[], subscriptions: [] as any[], workspaces: [] as any[] };
  if (phoneKey) {
    // Every account on this phone — a second account must not reset history.
    const accounts = await User.find({ phone: { $in: storedPhoneVariants(phoneKey) } })
      .select('_id subscriptionPlan')
      .lean<Array<{ _id: unknown; subscriptionPlan?: string }>>();
    const ids = accounts.map((a) => a._id);
    const [subscriptions, workspaces] = await Promise.all([
      Subscription.find({ userId: { $in: ids } }).select('planType currentPeriodEnd').lean(),
      Business.find({ userId: { $in: ids } }).select('subscriptionStatus subscriptionCurrentPeriodEnd trialStartedAt').lean(),
    ]);
    phonePaid = { userPlans: accounts.map((a) => a.subscriptionPlan ?? 'Free'), subscriptions, workspaces };
  }

  const verdict = trialEligibility({
    phoneKey,
    phoneVerified: !!user.isPhoneVerified,
    workspace,
    phonePaid,
  });
  if (!verdict.eligible) return verdict;
  return { eligible: true, phoneKey: phoneKey! };
}

export async function fetchRazorpaySubscriptionFacts(id: string): Promise<RazorpaySubscriptionFacts | 'unavailable'> {
  const razorpay = getRazorpay();
  if (!razorpay) return 'unavailable';
  const sub: any = await razorpay.subscriptions.fetch(id);
  return {
    status: String(sub.status),
    paidCount: Number(sub.paid_count ?? 0),
    hasPaymentMethod: !!sub.payment_method,
    hasCustomer: !!sub.customer_id,
  };
}

export const razorpaySettleDeps: SettleDeps = {
  fetchSubscription: fetchRazorpaySubscriptionFacts,
  cancelSubscription: async (id) => {
    const razorpay = getRazorpay();
    if (!razorpay) throw new Error('billing not configured');
    await razorpay.subscriptions.cancel(id, false);
  },
};

/**
 * Eligibility + atomic reservation. If the phone's previous reservation has
 * passed its window, Razorpay is asked once whether it can still be
 * authorized before anything is released.
 */
export async function reserveTrialForCheckout(
  userId: string,
  businessId: string,
  deps: SettleDeps = razorpaySettleDeps
): Promise<{ trial: true; claim: any; reused: boolean } | { trial: false; reason: TrialDenyReason }> {
  const eligibility = await checkTrialEligibility(userId, businessId);
  if (!eligibility.eligible) return { trial: false, reason: eligibility.reason };

  const phoneHash = trialPhoneHash(eligibility.phoneKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await reserveTrialClaim(TrialClaim, { phoneHash, userId, businessId, now: new Date() });
    if (result.ok) return { trial: true, claim: result.claim, reused: result.reused };
    if (result.reason !== 'reservation_expired') return { trial: false, reason: result.reason };
    const action = await settleTrialReservation(TrialClaim, result.claim, deps, new Date());
    if (action !== 'release') {
      return { trial: false, reason: action === 'consume' ? 'phone_claimed' : 'reservation_unresolved' };
    }
  }
  return { trial: false, reason: 'reservation_unresolved' };
}
