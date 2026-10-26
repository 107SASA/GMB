import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { createPlatformLead } from '@/services/admin/platformCrm';

export const dynamic = 'force-dynamic';

/** POST /api/admin/crm/leads — add a lead by hand (super admin CRM). */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'Invalid body.' }, { status: 400 });
    const res = await createPlatformLead(body, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error, ...(res.leadId ? { leadId: res.leadId } : {}) }, { status: res.status });
    return NextResponse.json({ success: true, leadId: res.leadId }, { status: 201 });
  } catch (error: any) {
    console.error('[admin/crm/leads] POST failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
