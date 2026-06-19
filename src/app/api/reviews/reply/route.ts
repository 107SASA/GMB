import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';

export async function POST(request: Request) {
  try {
    await dbConnect();
    const { reviewId, replyText } = await request.json();

    if (!reviewId || !replyText) {
      return NextResponse.json({ success: false, message: 'Missing reviewId or replyText' }, { status: 400 });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return NextResponse.json({ success: false, message: 'Review not found' }, { status: 404 });
    }

    review.aiSuggestedReply = replyText;
    review.replyStatus = 'POSTED'; // Or 'PENDING' if we have an integration later
    review.response = replyText;
    await review.save();

    return NextResponse.json({ success: true, review });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
