import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { partnerPayoutsFor } from '@/services/partners/partnerCommissions';

/** The signed-in partner's payouts. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await partnerPayoutsFor(String(auth.partner._id)) });
  } catch (error: any) {
    console.error('[partner/payouts] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load payouts' }, { status: 500 });
  }
}
