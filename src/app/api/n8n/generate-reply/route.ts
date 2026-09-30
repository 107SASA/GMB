import { NextResponse } from 'next/server';
import { validateApiKey } from '@/middleware/apiKeyAuth';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import { draftReply } from '@/services/reviews/replyPipeline';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export async function POST(req: Request) {
  const auth = validateApiKey(req);
  if (!auth.ok) return auth.response;

  try {
    const { reviewId } = await req.json();

    if (!reviewId) {
      return NextResponse.json(
        { success: false, error: 'reviewId is required' },
        { status: 400 }
      );
    }

    await dbConnect();

    const review = await Review.findById(reviewId);
    if (!review) {
      return NextResponse.json({ success: false, error: 'Review not found' }, { status: 404 });
    }

    // Same fact-checked drafting as the dashboard; never publishes.
    const d = await draftReply(String(review.businessId), String(review._id), { tone: 'Professional' });
    if (d.error || !d.reply) {
      return NextResponse.json({ success: false, error: 'Could not draft a reply right now.' }, { status: 502 });
    }
    const aiReply = d.reply;

    return NextResponse.json({
      success: true,
      reviewId,
      replyText: aiReply,
      replyStatus: d.status,
      validation: d.validation,
    });
  } catch (error: any) {
    console.error('[n8n/generate-reply]', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
