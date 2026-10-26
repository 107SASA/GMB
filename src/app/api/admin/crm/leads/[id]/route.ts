import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { updatePlatformLead } from '@/services/admin/platformCrm';

export const dynamic = 'force-dynamic';

/** PATCH /api/admin/crm/leads/:id — edit a lead's details, stage, owner, nurture or deal value. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'Invalid body.' }, { status: 400 });
    const res = await updatePlatformLead(id, body, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[admin/crm/leads/:id] PATCH failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
