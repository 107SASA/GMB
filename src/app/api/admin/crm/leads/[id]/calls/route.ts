import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { logPlatformCall } from '@/services/admin/platformCrmActivity';

export const dynamic = 'force-dynamic';

/** POST /api/admin/crm/leads/:id/calls — log a phone call (direction, outcome, duration, notes). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const res = await logPlatformCall(id, body ?? {}, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error: any) {
    console.error('[admin/crm/calls] POST failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
