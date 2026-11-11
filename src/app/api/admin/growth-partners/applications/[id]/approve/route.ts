import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { approveApplication } from '@/services/partners/partnerAdmin';

/**
 * Approve a Growth Partner application with that partner's own terms
 * (first-payment %, recurring %, hold days, optional recurring limit).
 * Creates the partner and emails the account-creation link.
 */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/applications/[id]/approve'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await approveApplication(id, body, auth.userId, { headers: req.headers, url: req.url });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    const { ok: _ok, ...data } = result;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[admin/growth-partners] approve failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to approve application' }, { status: 500 });
  }
}
