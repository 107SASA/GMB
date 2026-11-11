import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { adminPayoutList } from '@/services/partners/partnerCommissions';

/** Payout history. ?partnerId= */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await adminPayoutList(req.nextUrl.searchParams.get('partnerId') ?? undefined) });
  } catch (error: any) {
    console.error('[admin/growth-partners/payouts] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load payouts' }, { status: 500 });
  }
}
