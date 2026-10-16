import { NextResponse } from 'next/server';
import TrialClaim from '@/models/TrialClaim';
import { requireBusinessContext } from '@/lib/tenant';
import { addMonthsUtc } from '@/lib/billing/billingPolicy';
import { trialPhoneHash } from '@/lib/billing/trialClaims';
import { getActivePlan } from '@/lib/billing/planCatalog';
import { getTrialPolicy } from '@/services/billing/trialPolicyStore';
import { checkTrialEligibility } from '@/services/billing/trialEligibility';

export const dynamic = 'force-dynamic';

/**
 * Read-only preview for the checkout page: is the free trial on, would THIS
 * customer + workspace get it, and the server-computed dates to show. Reserves
 * nothing — POST /api/billing/checkout makes the real decision.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const policy = await getTrialPolicy();
  if (!policy.offerEnabled) {
    return NextResponse.json({ success: true, offer: null });
  }

  const [plan, eligibility] = await Promise.all([getActivePlan(), checkTrialEligibility(ctx.userId, ctx.businessId)]);
  let eligible = eligibility.eligible;
  let reason: string | null = eligibility.eligible ? null : eligibility.reason;

  if (eligibility.eligible) {
    const claim = await TrialClaim.findOne({ phoneHash: trialPhoneHash(eligibility.phoneKey) })
      .select('status holderBusinessId reservedUntil')
      .lean<any>();
    const heldElsewhere =
      claim &&
      (claim.status === 'consumed' ||
        (claim.status === 'reserved' && String(claim.holderBusinessId) !== String(ctx.businessId)));
    if (heldElsewhere) {
      eligible = false;
      reason = 'phone_claimed';
    }
  }

  const yearly = plan.durations.find((d) => d.cycle === policy.eligibleCycle && d.enabled);
  const trialEndsAt = addMonthsUtc(new Date(), policy.trialMonths);
  return NextResponse.json({
    success: true,
    offer: {
      months: policy.trialMonths,
      cycle: policy.eligibleCycle,
      eligible: eligible && !!yearly,
      reason: yearly ? reason : 'plan_unavailable',
      needsPhoneVerification: reason === 'phone_unverified',
      preview: yearly
        ? { trialEndsAt: trialEndsAt.toISOString(), firstChargeAt: trialEndsAt.toISOString(), firstChargeInr: yearly.priceInr }
        : null,
    },
  });
}
