import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Review from '@/models/Review';
import mongoose from 'mongoose';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');

    if (!businessId) {
      return NextResponse.json({ success: false, message: 'Missing businessId' }, { status: 400 });
    }

    const _businessId = new mongoose.Types.ObjectId(businessId);

    const [totalRequests, clickedRequests, reviewedRequests, reviews] = await Promise.all([
      ReviewRequest.countDocuments(), // Could filter by customer's business ID with aggregation
      ReviewRequest.countDocuments({ clicked: true }), // or status: 'CLICKED'
      ReviewRequest.countDocuments({ status: 'REVIEWED' }),
      Review.find({ businessId: _businessId })
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
        responseRate: totalRequests > 0 ? ((reviewedRequests / totalRequests) * 100).toFixed(1) + '%' : '0%',
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
