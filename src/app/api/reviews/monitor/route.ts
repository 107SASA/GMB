import { NextResponse } from "next/server";
import { processNewReviews } from "@/services/reviews";
import { requireBusinessContext } from "@/lib/tenant";

// Triggered by a cron job or n8n webhook — requires a valid session.
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const businessIdFromQuery = searchParams.get("businessId") ?? undefined;

    const ctx = await requireBusinessContext({ businessIdFromBody: businessIdFromQuery });
    if (!ctx.ok) return ctx.response;

    const result = await processNewReviews(ctx.businessId);

    if (result.success) {
      return NextResponse.json({ success: true, stats: result.stats });
    } else {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
