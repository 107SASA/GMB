import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getCampaign } from '@/services/admin/whatsappCampaigns';

export const dynamic = 'force-dynamic';

/** GET — one send's progress and each lead's result. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ success: false, error: 'Send not found.' }, { status: 404 });
  return NextResponse.json({ success: true, campaign });
}
