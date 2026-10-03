import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import CallEvent from '@/models/CallEvent';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { computeCrmRoi, missedOpportunityLines } from '@/services/crm/roi';

const DAY = 86_400_000;
const MAX_DAYS = 366;

/**
 * Customer CRM revenue / ROI for the active workspace.
 * ?days=30 (default) or ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive).
 * Converted = lifeCycleStage 'converted'; revenue = recorded deal values;
 * ROI % only when the owner configured an investment — otherwise
 * roiPercent is null with "ROI unavailable — investment/cost not configured."
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const url = new URL(req.url);
    let from: Date;
    let to: Date;
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    if (fromQ && toQ) {
      from = new Date(fromQ);
      to = new Date(new Date(toQ).getTime() + DAY);
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
      }
      if (to.getTime() - from.getTime() > MAX_DAYS * DAY) {
        return NextResponse.json({ error: `The range can be at most ${MAX_DAYS} days` }, { status: 400 });
      }
    } else {
      const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 30));
      to = new Date();
      from = new Date(to.getTime() - days * DAY);
    }

    await dbConnect();
    const businessId = new mongoose.Types.ObjectId(ctx.businessId);
    const fields = 'source lifeCycleStage createdAt convertedAt deal';
    const [leads, calls, business] = await Promise.all([
      Lead.find({ businessId, createdAt: { $gte: from, $lt: to } }).select(fields).lean(),
      CallEvent.find({ businessId, direction: 'inbound', startedAt: { $gte: from, $lt: to } })
        .select('phone startedAt outcome leadState leadId').lean(),
      Business.findById(ctx.businessId).select('crmInvestment').lean() as Promise<any>,
    ]);
    const savedIds = Array.from(new Set(
      (calls as any[]).filter((c) => c.leadState === 'saved' && c.leadId).map((c) => String(c.leadId)),
    ));
    const callLeads = savedIds.length
      ? await Lead.find({ _id: { $in: savedIds }, businessId }).select(fields).lean()
      : [];

    const roi = computeCrmRoi({
      leads: leads as any[],
      calls: (calls as any[]).map((c) => ({ ...c, leadId: c.leadId ? String(c.leadId) : null })),
      callLeads: callLeads as any[],
      from,
      to,
      investment: business?.crmInvestment ?? null,
    });
    return NextResponse.json({
      success: true,
      roi,
      missedOpportunities: missedOpportunityLines(roi),
      investmentConfigured: !!(business?.crmInvestment?.monthlyAmount > 0),
    });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
