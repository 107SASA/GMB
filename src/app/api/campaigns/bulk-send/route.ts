import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Campaign from '@/models/Campaign';
import Customer from '@/models/Customer';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { requirePlaceIdForReviews } from '@/lib/reviewCampaignGuard';
import { startQueuedCampaign } from '@/services/reviews/campaignQueue';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * "Send review requests to all of them" — after a bulk upload (customerIds)
 * or for every customer never asked yet (scope: 'not_requested'). Creates an
 * ACTIVE campaign and queues them: they go out at the daily WhatsApp limit,
 * reminders first (services/reviews/campaignQueue.ts). Nothing is sent
 * beyond today's limit.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'marketing_automation', ctx.businessId);
  if (!gate.ok) return gate.response;

  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const placeIdError = await requirePlaceIdForReviews(ctx.businessId);
    if (placeIdError) return NextResponse.json({ success: false, message: placeIdError }, { status: 400 });

    const ids: string[] = Array.isArray(body.customerIds) ? body.customerIds.filter((x: unknown) => typeof x === 'string' && mongoose.isValidObjectId(x)).slice(0, 5000) : [];
    if (!ids.length && body.scope !== 'not_requested') {
      return NextResponse.json({ success: false, message: 'Choose who to send to.' }, { status: 400 });
    }
    const query: any = {
      businessId: ctx.businessId,
      optedOut: { $ne: true },
      phone: { $exists: true, $nin: [null, ''] },
      ...(ids.length ? { _id: { $in: ids } } : { $or: [{ reviewStatus: 'Pending' }, { reviewStatus: { $exists: false } }] }),
    };
    const customers = await Customer.find(query).select('_id').sort({ createdAt: 1 }).lean();
    if (!customers.length) {
      return NextResponse.json({ success: false, message: 'None of these customers can get a WhatsApp review request (no phone number, or they opted out).' }, { status: 400 });
    }

    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const campaign = await Campaign.create({
      name: ids.length ? `Bulk upload · ${date}` : `Everyone not asked yet · ${date}`,
      channel: 'WHATSAPP',
      status: 'ACTIVE',
      startedAt: new Date(),
      businessId: ctx.businessId,
      tenantId: ctx.organizationId,
      targetTags: [],
    });
    const launch = await startQueuedCampaign(String(campaign._id), ctx.businessId, customers.map((c: any) => String(c._id)));
    return NextResponse.json({ success: true, campaignId: String(campaign._id), customers: customers.length, ...launch });
  } catch (error: any) {
    console.error('[campaigns/bulk-send] failed:', error);
    return NextResponse.json({ success: false, message: toFriendlyMessage(error) }, { status: 500 });
  }
}
