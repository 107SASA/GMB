import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { partnerCommissionsFor } from '@/services/partners/partnerCommissions';

/** The signed-in partner's commissions and totals. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await partnerCommissionsFor(String(auth.partner._id)) });
  } catch (error: any) {
    console.error('[partner/commissions] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load commissions' }, { status: 500 });
  }
}
