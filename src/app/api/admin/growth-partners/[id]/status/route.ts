import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { setPartnerSuspended } from '@/services/partners/partnerAdmin';

/** Suspend a partner (signs them out everywhere) or reactivate them. Body: { suspended: boolean }. */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]/status'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.suspended !== 'boolean') {
      return NextResponse.json({ success: false, error: 'suspended must be true or false' }, { status: 400 });
    }
    const result = await setPartnerSuspended(id, body.suspended, auth.userId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: { status: result.status } });
  } catch (error: any) {
    console.error('[admin/growth-partners] status change failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to update partner' }, { status: 500 });
  }
}
