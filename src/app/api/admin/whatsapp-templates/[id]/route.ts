import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { refreshTemplate, removeTemplate, updateTemplate } from '@/services/admin/whatsappCampaigns';

export const dynamic = 'force-dynamic';

/** PATCH { refresh: true } re-reads it from Twilio; { label?, active? } renames or switches it on/off. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = body?.refresh === true ? await refreshTemplate(id) : await updateTemplate(id, body || {});
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, template: res.template });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const res = await removeTemplate(id);
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true });
}
