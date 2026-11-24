import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import ReportShare from '@/models/ReportShare';
import { requireAuditAccess } from '@/lib/tenant';
import { isReportShareToken } from '@/lib/reportShareToken';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';

/** Re-opening within this window (refresh, tab switch) is the same visit. */
const VIEW_WINDOW_MS = 30 * 60 * 1000;

/**
 * Counts one view of a finished free report (/free-report/result calls this
 * once per page load) for the super-admin "Hot leads" card. `ref` is either
 * the WhatsApp share token or the signed-in owner's audit id. Super-admin
 * views are not counted. Always answers 200 — the report page never waits on it.
 */
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rate = await checkDurableRateLimit(`free-report-viewed:${ip}`, 30, 15 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: true, counted: false });

    const body = await req.json().catch(() => ({}));
    const ref = typeof body.ref === 'string' ? body.ref.trim().slice(0, 200) : '';
    if (!ref) return NextResponse.json({ success: true, counted: false });

    await dbConnect();
    let audit: any = null;
    if (isReportShareToken(ref)) {
      const share: any = await ReportShare.findOne({ token: ref }).select('auditId expiresAt').lean();
      if (share && new Date(share.expiresAt) > new Date()) {
        audit = await Audit.findById(share.auditId).select('businessId status').lean();
      }
    } else {
      const ctx = await requireAuditAccess(ref);
      if (!ctx.ok) return NextResponse.json({ success: true, counted: false });
      // Staff opening a customer's report isn't the customer's interest.
      const { default: User } = await import('@/models/User');
      const viewer: any = await User.findById(ctx.userId).select('role').lean();
      if (viewer?.role === 'SUPER_ADMIN' || viewer?.role === 'TEAM_MEMBER') {
        return NextResponse.json({ success: true, counted: false });
      }
      audit = ctx.audit;
    }
    if (!audit?.businessId || audit.status !== 'COMPLETED') {
      return NextResponse.json({ success: true, counted: false });
    }

    const now = new Date();
    const res = await Business.updateOne(
      {
        _id: audit.businessId,
        $or: [
          { freeReportLastViewedAt: { $exists: false } },
          { freeReportLastViewedAt: null },
          { freeReportLastViewedAt: { $lt: new Date(now.getTime() - VIEW_WINDOW_MS) } },
        ],
      },
      { $inc: { freeReportViewCount: 1 }, $set: { freeReportLastViewedAt: now } }
    );
    return NextResponse.json({ success: true, counted: res.modifiedCount > 0 });
  } catch (err) {
    console.warn('[free-report/viewed]', (err as Error)?.message);
    return NextResponse.json({ success: true, counted: false });
  }
}
