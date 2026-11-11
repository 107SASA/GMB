import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { searchCustomerWorkspaces } from '@/services/partners/partnerAssign';

/** Find customer workspaces by business name, owner name, phone or email (?q=). */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await searchCustomerWorkspaces(req.nextUrl.searchParams.get('q')) });
  } catch (error: any) {
    console.error('[admin/growth-partners/workspaces] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 });
  }
}
