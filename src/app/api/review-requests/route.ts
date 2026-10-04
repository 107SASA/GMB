import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Customer from '@/models/Customer';
import { requireBusinessContext } from '@/lib/tenant';
import { aggregateReviewRequestMetrics, toBusinessReviewSummary } from '@/lib/reviewRequestFlow';

export const dynamic = 'force-dynamic';

/**
 * Business-facing review-request metrics and latest status per customer.
 * Web and mobile both read this. Provider errors, SIDs, and tokens are not
 * selected and are not returned.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const businessId = new mongoose.Types.ObjectId(ctx.businessId);
    const rows = await ReviewRequest.find({ businessId })
      .sort({ createdAt: -1 })
      .select('customerId status sentAt deliveredAt readAt clickedAt createdAt followUpStage automationStatus')
      .lean();

    const metrics = aggregateReviewRequestMetrics(rows);
    const latestByCustomer: Record<string, ReturnType<typeof toBusinessReviewSummary>> = {};
    for (const row of rows) {
      const customerId = String(row.customerId);
      if (!latestByCustomer[customerId]) {
        latestByCustomer[customerId] = toBusinessReviewSummary(row);
      }
    }

    const recentRows = rows.slice(0, 20);
    const customers = await Customer.find({
      _id: { $in: recentRows.map((row) => row.customerId) },
      businessId,
    }).select('name').lean();
    const nameById = new Map(customers.map((customer) => [String(customer._id), customer.name]));

    const recent = recentRows.map((row) => ({
      customerName: nameById.get(String(row.customerId)) || 'Customer',
      ...toBusinessReviewSummary(row),
    }));

    return NextResponse.json({ success: true, metrics, latestByCustomer, recent });
  } catch (error) {
    console.error('[review-requests] list failed:', error);
    return NextResponse.json({ success: false, message: 'Could not load review requests' }, { status: 500 });
  }
}
