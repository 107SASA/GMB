import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { previewNurtureDecision } from '@/services/nurture/nurtureAdminConfig';

export const dynamic = 'force-dynamic';

/** Read-only explanation. Does not send, schedule, or update the lead. */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : '';
  if (!leadId) {
    return NextResponse.json({ success: false, error: 'Lead id is required.' }, { status: 400 });
  }
  const result = await previewNurtureDecision(leadId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 404 });
  }
  return NextResponse.json({ success: true, preview: result });
}
