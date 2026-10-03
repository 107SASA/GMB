import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { loadGrowthReport } from '@/services/crm/growthReportData';

/**
 * GET /api/crm/growth-report?month=YYYY-MM | current — Customer CRM Monthly
 * Growth Report for the ACTIVE workspace (web + mobile read the same data).
 * No month → the latest completed month. The workspace is resolved on the
 * server; any businessId sent by the client is ignored.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const month = new URL(req.url).searchParams.get('month');
    const r = await loadGrowthReport(ctx.businessId, month);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ success: true, report: r.report });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
