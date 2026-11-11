import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { reviewKyc } from '@/services/partners/partnerKyc';

/** Verify or reject a partner's submitted KYC. Body: { decision: 'verify' | 'reject', reason? }. */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]/kyc/review'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await reviewKyc(id, body.decision, body.reason, auth.userId);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { kycStatus: result.kycStatus } });
  } catch (error: any) {
    console.error('[admin/growth-partners/kyc] review failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to save the review' }, { status: 500 });
  }
}
