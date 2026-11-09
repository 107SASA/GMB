import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import Customer from '@/models/Customer';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { requirePlaceIdForReviews } from '@/lib/reviewCampaignGuard';
import { startQueuedCampaign } from '@/services/reviews/campaignQueue';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  // ADDITIVE (Sep 2026) — marketing_automation was never actually enforced
  // server-side; see lib/moduleGating.ts.
  const gate = await requireModule(ctx.userId, 'marketing_automation');
  if (!gate.ok) return gate.response;

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

    const placeIdError = await requirePlaceIdForReviews(ctx.businessId);
    if (placeIdError) {
      return NextResponse.json({ success: false, message: placeIdError }, { status: 400 });
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
    const customers = await Customer.find(customerQuery).select('_id').lean();

    // Queue everyone; the daily dispatcher starts only what today's WhatsApp
    // limit allows, after reserving room for reminders due today
    // (services/reviews/campaignQueue.ts). Launching used to message every
    // customer at once, far past the plan's daily limit.
    campaign.status = 'ACTIVE';
    if (!campaign.startedAt) campaign.startedAt = new Date();
    await campaign.save();
    const launch = await startQueuedCampaign(String(campaign._id), ctx.businessId, customers.map((c: any) => String(c._id)));
    if (!launch.startedToday && !launch.waiting && !launch.queued) {
      return NextResponse.json({ success: false, message: launch.message }, { status: 400 });
    }
    // requestsQueued kept for older clients.
    return NextResponse.json({ success: true, launched: true, ...launch, requestsQueued: launch.startedToday });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
