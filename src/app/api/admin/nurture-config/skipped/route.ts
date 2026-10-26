import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { recentSkippedNurture } from '@/services/nurture/nurtureAdminConfig';

export const dynamic = 'force-dynamic';

/** GET /api/admin/nurture-config/skipped?limit=50 — recent skipped invitations / follow-ups and why. Read only. */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit')) || 50;
    return NextResponse.json({ success: true, skipped: await recentSkippedNurture(limit) });
  } catch (error: any) {
    console.error('[admin/nurture-config/skipped] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
