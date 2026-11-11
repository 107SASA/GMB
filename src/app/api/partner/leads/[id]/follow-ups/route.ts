import { NextRequest, NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { createPartnerFollowUp } from '@/services/partners/partnerLeads';

/** Schedule a follow-up reminder for the partner (never a message to the lead). */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/partner/leads/[id]/follow-ups'>) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createPartnerFollowUp(String(auth.partner._id), auth.userId, id, body);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { followUpId: result.followUpId } });
  } catch (error: any) {
    console.error('[partner/leads/follow-ups] POST failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not schedule the follow-up' }, { status: 500 });
  }
}
