import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { addTemplate, listTemplates } from '@/services/admin/whatsappCampaigns';

export const dynamic = 'force-dynamic';

/** GET — the WhatsApp templates the team may send to leads. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, templates: await listTemplates() });
}

/** POST { contentSid, label? } — add an approved Twilio template by its SID (no server change needed). */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const res = await addTemplate(body || {}, auth.userId);
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, template: res.template }, { status: 201 });
}
