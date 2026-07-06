import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { resolveLeadStagesConfig, sanitizeLeadStagesConfig } from '@/lib/leadStages';

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

    await Business.findByIdAndUpdate(ctx.businessId, { leadStages: cleaned });

    return NextResponse.json({ success: true, leadStages: cleaned });
  } catch (error) {
    console.error('PATCH lead-stages error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}
