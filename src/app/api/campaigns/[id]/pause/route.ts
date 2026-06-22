import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import { requireBusinessContext } from '@/lib/tenant';

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

    campaign.status = 'PAUSED';
    await campaign.save();

    return NextResponse.json({ success: true, message: 'Campaign paused' });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
