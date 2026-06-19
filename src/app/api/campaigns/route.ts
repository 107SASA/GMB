import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';

export async function GET() {
  try {
    await dbConnect();
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    
    // Compute stats dynamically or use stored stats
    const formattedCampaigns = campaigns.map((c: any) => ({
      id: c._id,
      name: c.name,
      channel: c.channel,
      status: c.status,
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
  try {
    await dbConnect();
    const { name, channel, customerIds } = await request.json();

    if (!name || !channel || !customerIds) {
      return NextResponse.json({ success: false, message: 'Missing fields' }, { status: 400 });
    }

    // Default businessId (should come from session/auth ideally)
    const businessId = '666666666666666666666666'; // Mock ObjectId for now

    const campaign = await Campaign.create({
      name,
      channel,
      status: 'DRAFT',
      totalRequests: customerIds.length,
      businessId,
    });

    // In a real app we'd also store the relationship between campaign and customerIds
    // in ReviewRequest with status = 'QUEUED'. For now we just create the campaign.

    return NextResponse.json({ success: true, campaign });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
