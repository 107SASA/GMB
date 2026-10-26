import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { bulkStagePlatformLeads } from '@/services/admin/platformCrm';

export const dynamic = 'force-dynamic';

/** POST /api/admin/crm/leads/bulk — { ids, stage }: move selected leads to one stage. */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => null);
    const res = await bulkStagePlatformLeads(body?.ids, body?.stage, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, updated: res.updated, skipped: res.skipped });
  } catch (error: any) {
    console.error('[admin/crm/leads/bulk] POST failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
