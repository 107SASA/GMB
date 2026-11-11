import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { linkWorkspaceToPartner } from '@/services/partners/partnerAssign';

/** Link a customer workspace to a partner (wins over automatic matching). Body: { partnerId: string | null, creditPast?: boolean } */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/workspaces/[businessId]/partner'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { businessId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await linkWorkspaceToPartner(businessId, body, auth.userId);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { partner: result.partner, credited: result.credited } });
  } catch (error: any) {
    console.error('[admin/growth-partners/workspaces/partner] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to link the workspace' }, { status: 500 });
  }
}
