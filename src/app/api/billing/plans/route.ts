import { NextResponse } from 'next/server';
import { publicCatalog } from '@/lib/billing/planCatalog';
import { getTrialPolicy } from '@/services/billing/trialPolicyStore';

export const dynamic = 'force-dynamic';

/**
 * Public: the one sellable plan, for the pricing page and the audit-report
 * subscribe panel. `plans` (single-element array) is kept for callers that
 * still map over it. `trialOffer` is for display only — whether a given
 * customer actually gets the trial is decided at checkout, on the server.
 */
export async function GET() {
  const [catalog, policy] = await Promise.all([publicCatalog(), getTrialPolicy()]);
  const plan = {
    ...catalog,
    trialOffer: policy.offerEnabled ? { months: policy.trialMonths, cycle: policy.eligibleCycle } : null,
  };
  return NextResponse.json({ success: true, plan, plans: [plan] });
}
