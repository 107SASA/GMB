import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { previewSend } from '@/services/admin/whatsappCampaigns';

export const dynamic = 'force-dynamic';

/** POST { ids | filters, templateId, message, skipRecent } — who would get it, who is left out and why. Sends nothing. */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const res = await previewSend(body || {});
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  const { ok: _ok, ...data } = res;
  return NextResponse.json({ success: true, ...data });
}
