import { NextRequest, NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { addPartnerNote } from '@/services/partners/partnerLeads';

export async function POST(req: NextRequest, ctx: RouteContext<'/api/partner/leads/[id]/notes'>) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const result = await addPartnerNote(String(auth.partner._id), auth.userId, id, body?.text);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[partner/leads/notes] POST failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not save the note' }, { status: 500 });
  }
}
