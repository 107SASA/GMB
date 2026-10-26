import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { createSend, listCampaigns } from '@/services/admin/whatsappCampaigns';

export const dynamic = 'force-dynamic';

/** GET — recent WhatsApp sends to leads. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, campaigns: await listCampaigns() });
}

/** POST { ids | filters, templateId, message, name?, skipRecent } — start a send (runs in the background). */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const res = await createSend(body || {}, auth.userId);
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, campaignId: res.campaignId, queued: res.queued, skipped: res.skipped }, { status: 201 });
}
