import { NextResponse } from "next/server";
import { processNewReviews } from "@/services/reviews";

// This endpoint could be triggered by a Cron Job or n8n webhook
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get("businessId");
    
    if (!businessId) {
      return NextResponse.json({ error: "businessId is required" }, { status: 400 });
    }

    const result = await processNewReviews(businessId);
    
    if (result.success) {
      return NextResponse.json({ success: true, stats: result.stats });
    } else {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
