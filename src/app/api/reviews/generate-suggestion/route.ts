import { NextResponse } from 'next/server';
import { generateReviewSuggestions, personalizeReviewMessage } from '@/services/ai';

export async function POST(request: Request) {
  try {
    const { action, businessName, customerName, service, rating, channel } = await request.json();

    if (action === 'personalize') {
      const message = await personalizeReviewMessage(businessName, customerName, service, channel);
      return NextResponse.json({ success: true, message });
    } else {
      const suggestions = await generateReviewSuggestions(businessName, customerName, service, rating);
      return NextResponse.json({ success: true, suggestions });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
