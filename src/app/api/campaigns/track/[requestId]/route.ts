import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import BusinessConfig from '@/models/BusinessAIConfig'; // assuming we might store review link here, else fallback

export async function GET(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    await dbConnect();
    const resolvedParams = await params;
    const { requestId } = resolvedParams;

    const reviewRequest = await ReviewRequest.findById(requestId);
    if (!reviewRequest) {
      return NextResponse.json({ error: 'Invalid tracking link' }, { status: 404 });
    }

    // Mark as clicked
    if (!reviewRequest.clicked) {
      reviewRequest.clicked = true;
      reviewRequest.clickedAt = new Date();
      await reviewRequest.save();
    }

    // In a real app, fetch the actual Google Review Place ID link from the Business config
    // We'll use a hardcoded fallback for the demo
    const fallbackUrl = 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4';
    
    return NextResponse.redirect(fallbackUrl);

  } catch (error: any) {
    console.error('Tracking Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
