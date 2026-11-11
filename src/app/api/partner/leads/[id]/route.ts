import { NextRequest, NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { getPartnerLead, updatePartnerLead } from '@/services/partners/partnerLeads';

/** One of the partner's leads, with its partner-visible timeline and follow-ups. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/partner/leads/[id]'>) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const data = await getPartnerLead(String(auth.partner._id), auth.userId, id);
    if (!data) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[partner/leads/id] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load the lead' }, { status: 500 });
  }
}

/** Edit details or move the stage (not to Payment verified / Customer). */
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/partner/leads/[id]'>) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updatePartnerLead(String(auth.partner._id), auth.userId, id, body);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[partner/leads/id] PATCH failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not save the lead' }, { status: 500 });
  }
}
