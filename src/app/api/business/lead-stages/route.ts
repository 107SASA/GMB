import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import Business from '@/models/Business';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import {
  assignSubStageIds,
  resolveLeadStagesConfig,
  sanitizeLeadStagesConfig,
  SUB_STAGE_GROUPS,
} from '@/lib/leadStages';

/** The ONE stage model for web + mobile: lifeCycleStage groups + sub-stages with stable ids. */
export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await connectDB();
    const business = await Business.findById(ctx.businessId).select('leadStages').lean() as Record<string, any> | null;
    return NextResponse.json({
      success: true,
      leadStages: resolveLeadStagesConfig(business?.leadStages),
    });
  } catch (error) {
    console.error('GET lead-stages error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await connectDB();
    const body = await req.json();
    const cleaned = sanitizeLeadStagesConfig(body.leadStages);

    if (!cleaned) {
      return NextResponse.json(
        { success: false, message: 'Invalid lead stages payload' },
        { status: 400 }
      );
    }

    const business = await Business.findById(ctx.businessId).select('leadStages').lean() as Record<string, any> | null;
    const previous = resolveLeadStagesConfig(business?.leadStages);
    // Ids survive edits (and saves from older clients that don't send ids).
    const next = assignSubStageIds(cleaned, previous);

    await Business.findByIdAndUpdate(ctx.businessId, { leadStages: next });

    // A renamed sub-stage keeps its id — carry the new display name onto this
    // workspace's leads (and give legacy name-only rows the id).
    const businessId = new mongoose.Types.ObjectId(ctx.businessId);
    for (const g of SUB_STAGE_GROUPS) {
      for (const sub of next[g]) {
        const old = previous[g].find((p) => p.id === sub.id);
        if (!old || old.name === sub.name) continue;
        await Lead.updateMany(
          {
            businessId,
            lifeCycleStage: g,
            $or: [{ subStageId: sub.id }, { subStageId: { $in: [null, undefined] }, subStage: old.name }],
          },
          { $set: { subStage: sub.name, subStageId: sub.id } },
        );
      }
    }

    return NextResponse.json({ success: true, leadStages: next });
  } catch (error) {
    console.error('PATCH lead-stages error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}
