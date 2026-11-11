import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { listPartnerOpenFollowUps } from '@/services/partners/partnerLeads';

/** The partner's open follow-ups across all their leads, due first. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await listPartnerOpenFollowUps(String(auth.partner._id)) });
  } catch (error: any) {
    console.error('[partner/follow-ups] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load follow-ups' }, { status: 500 });
  }
}
