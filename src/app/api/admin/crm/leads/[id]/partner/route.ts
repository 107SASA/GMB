import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { assignLeadToPartner, getLeadPartner } from '@/services/partners/partnerAssign';

/** Which Growth Partner (if any) this platform lead is credited to. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/admin/crm/leads/[id]/partner'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const data = await getLeadPartner(id);
    if (!data) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[admin/crm/leads/partner] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load' }, { status: 500 });
  }
}

/**
 * Assign / change / remove the partner. Body:
 * { partnerId: string | null, mode: 'credit' | 'managed', creditPast?: boolean }
 */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/crm/leads/[id]/partner'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await assignLeadToPartner(id, body, auth.userId);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { partner: result.partner, credited: result.credited } });
  } catch (error: any) {
    console.error('[admin/crm/leads/partner] POST failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to assign the partner' }, { status: 500 });
  }
}
