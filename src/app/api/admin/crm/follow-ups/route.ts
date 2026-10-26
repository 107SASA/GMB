import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { listPlatformFollowUps } from '@/services/admin/platformCrmActivity';

export const dynamic = 'force-dynamic';

/** GET /api/admin/crm/follow-ups?mine=1&due=today — the team's open follow-ups, soonest first. */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const p = new URL(req.url).searchParams;
    const dueBefore = p.get('due') === 'today' ? new Date(new Date().setHours(23, 59, 59, 999)) : undefined;
    const followUps = await listPlatformFollowUps({ open: true, assignedUserId: p.get('mine') === '1' ? auth.userId : undefined, dueBefore });
    return NextResponse.json({ success: true, followUps });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
