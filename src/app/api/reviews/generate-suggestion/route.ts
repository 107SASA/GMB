import { NextResponse } from 'next/server';
import { generateReviewSuggestions, personalizeReviewMessage } from '@/services/ai';
import { requireBusinessContext } from '@/lib/tenant';
import { requireWorkspacePlan } from '@/lib/planGate';

export async function POST(request: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  // Paid feature: this workspace needs its own plan (lib/planGate.ts).
  const planGate = await requireWorkspacePlan(ctx.userId, ctx.businessId);
  if (!planGate.ok) return planGate.response;

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
