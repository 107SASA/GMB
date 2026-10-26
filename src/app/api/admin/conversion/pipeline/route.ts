import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { queryPipeline, toRow } from '@/services/admin/pipelineQuery';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500; // the Board view loads one larger page

/**
 * GET /api/admin/conversion/pipeline
 *
 * Lead Engine pipeline table for platform leads. EVERY filter — including
 * the derived ones (segment, stage label, demo, payment) — is applied before
 * paging, so the total and the pages always agree. Query params (optional):
 *   range / from / to   leads CREATED in this window (default: all time)
 *   segment             a key of SEGMENTS (lib/admin/leadMilestones.ts) —
 *                       what every Conversion Overview number links with
 *   agent               currentAgent
 *   ownership           'ai' | 'human' | 'customer' — combined with agent (AND)
 *   stage               current stage label (currentFunnelStage), as shown in the table
 *   intent / nba / nurture   exact field values
 *   minScore            leadScore >=
 *   demo                'scheduled' | 'completed' | 'none' | 'any' — from the lead's bookings
 *   payment             'verified' | 'trial' | 'pending' | 'none'
 *   q                   name, or phone in any format (spaces, +91, leading 0)
 *   sort                field:dir — createdAt | lastActivityAt | leadScore | aiLeadScore | nextActionAt
 *   page                1-based
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const p = new URL(req.url).searchParams;
    const { range, segment, rows, workspaces } = await queryPipeline(p);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(p.get('pageSize')) || PAGE_SIZE));
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Number(p.get('page')) || 1), totalPages);
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({
      success: true,
      range,
      segment,
      rows: pageRows.map((r) => toRow(r, workspaces.get(String(r.lead._id)))),
      pagination: { page, pageSize, total, totalPages },
    });
  } catch (error: any) {
    console.error('[admin/conversion/pipeline] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
