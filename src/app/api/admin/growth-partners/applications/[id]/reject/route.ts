import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { rejectApplication } from '@/services/partners/partnerAdmin';

/** Reject a Growth Partner application, with an optional reason that is emailed to the applicant. */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/applications/[id]/reject'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await rejectApplication(id, body.reason, auth.userId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: { emailSent: result.emailSent } });
  } catch (error: any) {
    console.error('[admin/growth-partners] reject failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to reject application' }, { status: 500 });
  }
}
