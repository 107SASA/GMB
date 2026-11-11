import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { adminCommissionList } from '@/services/partners/partnerCommissions';

/** All partner commissions + per-partner totals. ?partnerId= ?stage=on_hold|ready|approved|paid|reversed */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    const data = await adminCommissionList({ partnerId: sp.get('partnerId') ?? undefined, stage: sp.get('stage') ?? undefined });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[admin/growth-partners/commissions] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load commissions' }, { status: 500 });
  }
}
