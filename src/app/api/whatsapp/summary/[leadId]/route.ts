import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import mongoose from 'mongoose';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { getCurrentSummary, getSummaryHistory } from '@/services/whatsapp-agent/summaryService';

/**
 * ADDITIVE — exposes the AI-generated conversation summaries (Feature 8) to
 * the business dashboard. `?history=true` returns every past version
 * (summaries are never deleted, only superseded) for auditability.
 */
export async function GET(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { leadId } = await params;
    if (!mongoose.isValidObjectId(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid leadId' }, { status: 400 });
    }

    await dbConnect();
    const lead = await Lead.findOne({ _id: leadId, businessId: new mongoose.Types.ObjectId(ctx.businessId) });
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 403 });
    }

    const url = new URL(req.url);
    if (url.searchParams.get('history') === 'true') {
      const history = await getSummaryHistory(leadId);
      return NextResponse.json({ success: true, history });
    }

    const summary = await getCurrentSummary(leadId);
    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('[whatsapp/summary/:leadId][GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load summary' }, { status: 500 });
  }
}
