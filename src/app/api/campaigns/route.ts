import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import { requireBusinessContext } from '@/lib/tenant';

function serializeCampaign(c: any) {
  return {
    id: c._id,
    name: c.name,
    channel: c.channel,
    status: c.status,
    targetTags: c.targetTags ?? [],
    initialMessage: c.initialMessage ?? '',
    reminder1Enabled: c.reminder1Enabled ?? true,
    reminder1AfterDays: c.reminder1AfterDays ?? 2,
    reminder1Message: c.reminder1Message ?? '',
    reminder2Enabled: c.reminder2Enabled ?? true,
    reminder2AfterDays: c.reminder2AfterDays ?? 5,
    reminder2Message: c.reminder2Message ?? '',
    stopOnReview: c.stopOnReview ?? true,
    sendOnlyBizHours: c.sendOnlyBizHours ?? true,
    bizHoursStart: c.bizHoursStart ?? 9,
    bizHoursEnd: c.bizHoursEnd ?? 20,
    stats: {
      total: c.totalRequests || 0,
      sent: c.delivered || 0,
      clicked: c.clicked || 0,
      reviewed: c.reviewsReceived || 0
    }
  };
}

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const campaigns = await Campaign.find({ businessId: ctx.businessId }).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, campaigns: campaigns.map(serializeCampaign) });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const body = await request.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ success: false, message: 'Campaign name is required' }, { status: 400 });
    }

    const campaign = await Campaign.create({
      name: body.name.trim(),
      channel: 'WHATSAPP',
      status: 'DRAFT',
      businessId: ctx.businessId,
      tenantId: ctx.organizationId,
      targetTags: Array.isArray(body.targetTags) ? body.targetTags : [],
      initialMessage: body.initialMessage ?? '',
      reminder1Enabled: body.reminder1Enabled ?? true,
      reminder1AfterDays: body.reminder1AfterDays ?? 2,
      reminder1Message: body.reminder1Message ?? '',
      reminder2Enabled: body.reminder2Enabled ?? true,
      reminder2AfterDays: body.reminder2AfterDays ?? 5,
      reminder2Message: body.reminder2Message ?? '',
      stopOnReview: body.stopOnReview ?? true,
      sendOnlyBizHours: body.sendOnlyBizHours ?? true,
      bizHoursStart: body.bizHoursStart ?? 9,
      bizHoursEnd: body.bizHoursEnd ?? 20,
    });

    return NextResponse.json({ success: true, campaign: serializeCampaign(campaign) });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
