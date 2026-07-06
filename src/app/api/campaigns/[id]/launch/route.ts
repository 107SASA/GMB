import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import Customer from '@/models/Customer';
import ReviewRequest from '@/models/ReviewRequest';
import { inngest } from '@/services/inngest/client';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { id } = await params;

    const campaign = await Campaign.findOne({ _id: id, businessId: ctx.businessId });
    if (!campaign) {
      return NextResponse.json({ success: false, message: 'Campaign not found' }, { status: 404 });
    }

    // Lifecycle guard: a cancelled campaign can never resume/relaunch, and a completed
    // campaign is done — both must remain visible in history but cannot be reactivated.
    if (campaign.status === 'CANCELLED') {
      return NextResponse.json(
        { success: false, message: 'This campaign was cancelled and cannot be resumed.' },
        { status: 400 }
      );
    }
    if (campaign.status === 'COMPLETED') {
      return NextResponse.json(
        { success: false, message: 'This campaign has already completed and cannot be relaunched.' },
        { status: 400 }
      );
    }

    // Eligible customers: not opted out, has a phone (WhatsApp-only), and —
    // when the campaign targets groups — tagged with at least one of them.
    const customerQuery: any = {
      businessId: ctx.businessId,
      optedOut: { $ne: true },
      phone: { $exists: true, $nin: [null, ''] }
    };
    if (campaign.targetTags?.length > 0) {
      customerQuery.tags = { $in: campaign.targetTags };
    }
    const customers = await Customer.find(customerQuery).lean();

    // Skip customers who already have an active request for this campaign
    const events: Array<{ name: 'campaigns/review.request.start'; data: Record<string, string> }> = [];
    for (const customer of customers) {
      const hasActive = await ReviewRequest.exists({
        campaignId: campaign._id,
        customerId: customer._id,
        automationStatus: 'Active'
      });
      if (!hasActive) {
        events.push({
          name: 'campaigns/review.request.start',
          data: {
            customerId: customer._id.toString(),
            businessId: ctx.businessId,
            tenantId: ctx.organizationId,
            campaignId: campaign._id.toString()
          }
        });
      }
    }

    if (events.length > 0) {
      await inngest.send(events);
    }

    campaign.status = 'ACTIVE';
    // += so resuming a paused campaign keeps earlier requests in the total
    campaign.totalRequests = (campaign.totalRequests || 0) + events.length;
    if (!campaign.startedAt) campaign.startedAt = new Date();
    await campaign.save();

    return NextResponse.json({ success: true, launched: true, requestsQueued: events.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
