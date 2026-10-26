import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { updatePlatformFollowUp } from '@/services/admin/platformCrmActivity';

export const dynamic = 'force-dynamic';

/** PATCH — { status: 'completed' | 'cancelled' | 'pending', dueAt?, note? }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const res = await updatePlatformFollowUp(id, body ?? {}, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
