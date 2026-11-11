import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { listReferredBusinesses } from '@/services/partners/partnerLeads';

/** Workspaces that signed up through the partner's referral link. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await listReferredBusinesses(String(auth.partner._id)) });
  } catch (error: any) {
    console.error('[partner/referrals] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load referrals' }, { status: 500 });
  }
}
