import { NextResponse } from 'next/server';
import { validateApiKey } from '@/middleware/apiKeyAuth';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';

export async function GET(req: Request) {
  const auth = validateApiKey(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');

  if (!businessId) {
    return NextResponse.json(
      { success: false, error: 'businessId query param is required' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const reviews = await Review.find({
      businessId,
      $or: [{ replyText: { $exists: false } }, { replyText: null }, { replyText: '' }],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('_id rating reviewText reviewerName replyText createdAt')
      .lean();

    // Return flat array so n8n splits into individual items
    return NextResponse.json(
      reviews.map((r: any) => ({
        _id: r._id.toString(),
        rating: r.rating ?? 0,
        reviewText: r.reviewText || '',
        reviewerName: r.reviewerName || 'Anonymous',
        replyText: r.replyText || '',
      }))
    );
  } catch (error: any) {
    console.error('[n8n/sync-reviews]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
