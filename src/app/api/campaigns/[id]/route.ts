import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import { requireBusinessContext } from '@/lib/tenant';

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;

    const campaign = await Campaign.findOne({ _id: id, businessId: ctx.businessId });
    if (!campaign) {
      return NextResponse.json({ success: false, message: 'Campaign not found' }, { status: 404 });
    }

    // Issue 4: cancelled and completed campaigns must remain stored for history, so only a
    // campaign that was never launched (DRAFT) can be permanently removed. Use /cancel to end
    // an active or paused campaign instead — it stays visible in history afterward.
    if (campaign.status !== 'DRAFT') {
      return NextResponse.json(
        { success: false, message: `Only a draft campaign can be deleted (current status: ${campaign.status}). Cancel it instead to preserve history.` },
        { status: 400 }
      );
    }

    await Campaign.deleteOne({ _id: campaign._id });

    return NextResponse.json({ success: true, message: 'Campaign deleted' });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
