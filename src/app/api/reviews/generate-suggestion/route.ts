import { NextResponse } from 'next/server';
import { generateReviewSuggestions, personalizeReviewMessage } from '@/services/ai';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(request: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

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
