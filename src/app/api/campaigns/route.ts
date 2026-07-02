import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const campaigns = await Campaign.find({ businessId: ctx.businessId }).sort({ createdAt: -1 });

    const formattedCampaigns = campaigns.map((c: any) => ({
      id: c._id,
      name: c.name,
      channel: c.channel,
      status: c.status,
      day2Reminder: c.day2Reminder,
      day5Reminder: c.day5Reminder,
      stopOnReview: c.stopOnReview,
      stats: {
        total: c.totalRequests || 0,
        sent: c.delivered || 0,
        clicked: c.clicked || 0,
        reviewed: c.reviewsReceived || 0
      }
    }));

    return NextResponse.json({ success: true, campaigns: formattedCampaigns });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { name, channel, day2Reminder, day5Reminder, stopOnReview } = await request.json();

    if (!name || !channel) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    const campaign = await Campaign.create({
      name,
      channel: channel.toUpperCase(),
      status: 'DRAFT',
      businessId: ctx.businessId,
      tenantId: ctx.organizationId,
      day2Reminder: day2Reminder ?? true,
      day5Reminder: day5Reminder ?? true,
      stopOnReview: stopOnReview ?? true,
    });

    return NextResponse.json({ success: true, campaign });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
