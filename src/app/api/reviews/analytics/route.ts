import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Review from '@/models/Review';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const businessObjectId = new mongoose.Types.ObjectId(ctx.businessId);

    const [totalRequests, clickedRequests, reviewedRequests, reviews] = await Promise.all([
      ReviewRequest.countDocuments({ businessId: businessObjectId }),
      ReviewRequest.countDocuments({ businessId: businessObjectId, clicked: true }),
      ReviewRequest.countDocuments({ businessId: businessObjectId, status: 'REVIEWED' }),
      Review.find({ businessId: businessObjectId }),
    ]);

    const averageRating = reviews.length > 0
      ? reviews.reduce((acc, rev) => acc + rev.rating, 0) / reviews.length
      : 0;

    return NextResponse.json({
      success: true,
      analytics: {
        totalRequests,
        clickedRequests,
        reviewedRequests,
        totalReviews: reviews.length,
        averageRating: averageRating.toFixed(1),
        responseRate: totalRequests > 0
          ? ((reviewedRequests / totalRequests) * 100).toFixed(1) + '%'
          : '0%',
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
