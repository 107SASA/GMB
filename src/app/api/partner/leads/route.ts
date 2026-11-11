import { NextRequest, NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { createPartnerLead, listPartnerLeads } from '@/services/partners/partnerLeads';

/** The partner's own leads. ?q= search, ?stage= filter, ?view=customers for converted ones. */
export async function GET(req: NextRequest) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    const data = await listPartnerLeads(String(auth.partner._id), {
      q: sp.get('q') ?? undefined,
      stage: sp.get('stage') ?? undefined,
      customers: sp.get('view') === 'customers',
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[partner/leads] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not load your leads' }, { status: 500 });
  }
}

/** Add a lead. Refused when the number is already anywhere in our pipeline. */
export async function POST(req: Request) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createPartnerLead(auth.partner, auth.userId, body);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.lead });
  } catch (error: any) {
    console.error('[partner/leads] POST failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not add the lead' }, { status: 500 });
  }
}
