import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { reverseCommission } from '@/services/partners/partnerCommissions';

/** Reverse a commission (refund etc.). Already paid → clawed back from the next payout. Body: { reason } */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/commissions/[commissionId]/reverse'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { commissionId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const result = await reverseCommission(commissionId, body?.reason, auth.userId);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { clawback: result.clawback } });
  } catch (error: any) {
    console.error('[admin/growth-partners/commissions/reverse] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to reverse' }, { status: 500 });
  }
}
