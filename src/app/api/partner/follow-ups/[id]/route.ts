import { NextRequest, NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { updatePartnerFollowUp } from '@/services/partners/partnerLeads';

/** Mark a follow-up done / cancelled / pending. */
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/partner/follow-ups/[id]'>) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updatePartnerFollowUp(String(auth.partner._id), auth.userId, id, body);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[partner/follow-ups/id] PATCH failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not update the follow-up' }, { status: 500 });
  }
}
