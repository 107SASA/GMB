import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { syncReviewsForBusiness } from '@/services/reviews/syncReviews';

export async function POST(req: Request) {
  try {
    const { businessId } = await req.json();

    const ctx = await requireBusinessContext({ businessIdFromBody: businessId });
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const result = await syncReviewsForBusiness(ctx.businessId, ctx.organizationId);

    return NextResponse.json({
      success: true,
      synced: result.synced,
      analytics: result.analytics,
      reviews: result.reviews,
    });
  } catch (error: any) {
    console.error('[reviews/fetch] Failed to sync reviews:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
