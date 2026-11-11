import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { adminKycView } from '@/services/partners/partnerKyc';

/** A partner's full KYC, including PAN and bank account number. Each view is logged. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]/kyc'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const data = await adminKycView(id, auth.userId);
    if (!data) return NextResponse.json({ success: false, error: 'Partner not found' }, { status: 404 });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: any) {
    console.error('[admin/growth-partners/kyc] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load KYC' }, { status: 500 });
  }
}
