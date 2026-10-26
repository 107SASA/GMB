import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { crmStageLabel, csvField } from '@/lib/admin/platformCrm';
import { queryPipeline, toRow } from '@/services/admin/pipelineQuery';

export const dynamic = 'force-dynamic';

/** GET /api/admin/crm/export?<same filters as Leads & Pipeline> — the filtered leads as CSV. */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const { rows, workspaces } = await queryPipeline(new URL(req.url).searchParams);
    const header = ['name', 'phone', 'email', 'business', 'city', 'source', 'stage', 'owner', 'intent', 'score', 'demo', 'payment', 'deal_value_inr', 'tags', 'created_at', 'last_activity_at'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const row = toRow(r, workspaces.get(String(r.lead._id)));
      lines.push([
        row.name, row.phone, row.email, row.business, row.city, row.source, crmStageLabel(row.currentStage), row.ownership,
        row.intent, row.leadScore, row.demoStatus, row.paymentStatus, row.dealValue, (row.tags || []).join(';'),
        row.createdAt ? new Date(row.createdAt).toISOString() : '', row.lastActivityAt ? new Date(row.lastActivityAt).toISOString() : '',
      ].map(csvField).join(','));
    }
    {
      const { logSecurityEvent } = await import('@/services/security/securityLog');
      await logSecurityEvent(req, { type: 'admin.crm_export', outcome: 'success', userId: auth.userId, role: 'SUPER_ADMIN', detail: `${rows.length} leads exported`, metadata: { filters: new URL(req.url).search.slice(0, 300) } });
    }
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join('\n') + '\n', {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="growwmatics-leads-${date}.csv"` },
    });
  } catch (error: any) {
    console.error('[admin/crm/export] GET failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
