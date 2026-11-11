import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { partnerLeadStats } from '@/services/partners/partnerLeads';

/** Lead counts for the partner's overview. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await partnerLeadStats(String(auth.partner._id)) });
  } catch (error: any) {
    console.error('[partner/stats] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load stats' }, { status: 500 });
  }
}
