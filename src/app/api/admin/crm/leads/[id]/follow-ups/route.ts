import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { createPlatformFollowUp, listPlatformFollowUps } from '@/services/admin/platformCrmActivity';

export const dynamic = 'force-dynamic';

/** GET — this lead's follow-ups. POST — schedule one (a reminder for the team, never a message to the lead). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ success: true, followUps: await listPlatformFollowUps({ leadId: id }) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const res = await createPlatformFollowUp(id, body ?? {}, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, followUpId: res.followUpId }, { status: 201 });
  } catch (error: any) {
    console.error('[admin/crm/follow-ups] POST failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
