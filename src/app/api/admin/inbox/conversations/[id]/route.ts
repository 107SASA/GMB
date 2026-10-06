import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { inboxDetail } from '@/services/inbox/platformInbox';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const detail = await inboxDetail(decodeURIComponent(id));
  if (!detail) return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
  return NextResponse.json({ success: true, conversation: detail });
}
