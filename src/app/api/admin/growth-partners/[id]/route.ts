import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { updatePartnerTerms } from '@/services/partners/partnerAdmin';

/** Change one partner's commission terms. Applies to future payments only. */
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updatePartnerTerms(id, body, auth.userId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.partner });
  } catch (error: any) {
    console.error('[admin/growth-partners] PATCH failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to update partner' }, { status: 500 });
  }
}
