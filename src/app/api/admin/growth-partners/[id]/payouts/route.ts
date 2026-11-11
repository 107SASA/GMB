import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { createPayout } from '@/services/partners/partnerCommissions';

/** Record a payout of everything approved for this partner. Body: { reference, method?, paidAt?, tdsPercent?, note? } */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]/payouts'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createPayout(id, body, auth.userId);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    const { ok: _ok, ...data } = result;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[admin/growth-partners/payouts] create failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to record the payout' }, { status: 500 });
  }
}
