import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { approveCommissions } from '@/services/partners/partnerCommissions';

/** Approve commissions whose hold period is over. Body: { ids: string[] } */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await approveCommissions(body?.ids, auth.userId);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { approved: result.approved, skipped: result.skipped } });
  } catch (error: any) {
    console.error('[admin/growth-partners/commissions/approve] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to approve' }, { status: 500 });
  }
}
