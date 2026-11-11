import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { resendPartnerInvite } from '@/services/partners/partnerAdmin';

/** Email a fresh account-creation link to a partner who hasn't signed up yet. */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]/resend-invite'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const result = await resendPartnerInvite(id, auth.userId, { headers: req.headers, url: req.url });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: { inviteLink: result.inviteLink, emailSent: result.emailSent } });
  } catch (error: any) {
    console.error('[admin/growth-partners] resend invite failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to resend invite' }, { status: 500 });
  }
}
