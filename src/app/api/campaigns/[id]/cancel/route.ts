import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import { requireBusinessContext } from '@/lib/tenant';

// Lifecycle rules (Issue 3):
// - An ACTIVE campaign can be cancelled.
// - A PAUSED campaign can be cancelled.
// - A CANCELLED campaign is terminal — it can never resume, but remains stored for history.
// - A DRAFT campaign was never launched, so there is nothing running to cancel (use delete instead).
// - A COMPLETED campaign is already finished and remains stored for history.
export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;

    const campaign = await Campaign.findOne({ _id: id, businessId: ctx.businessId });
    if (!campaign) {
      return NextResponse.json({ success: false, message: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.status !== 'ACTIVE' && campaign.status !== 'PAUSED') {
      return NextResponse.json(
        { success: false, message: `A campaign can only be cancelled while it is active or paused (current status: ${campaign.status}).` },
        { status: 400 }
      );
    }

    campaign.status = 'CANCELLED';
    campaign.cancelledAt = new Date();
    await campaign.save();

    return NextResponse.json({ success: true, message: 'Campaign cancelled' });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
