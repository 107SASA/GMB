import { NextResponse } from "next/server";
import { syncReviewsForBusiness } from "@/services/reviews/syncReviews";
import { requireBusinessContext } from "@/lib/tenant";

// Triggered by a cron job or n8n webhook — requires a valid session.
//
// ROOT CAUSE (Issue 1 — review count mismatch with Google Business Profile):
// This route used to call `processNewReviews` from the legacy `src/services/reviews.ts`,
// which pulls from `fetchGoogleReviews` — a function that returns hardcoded, static mock
// reviews ("John Doe", "Jane Smith") instead of calling any real API. Every time this route
// was hit, those fake reviews were written to the database as if they were real, inflating
// the stored review count above what Google Business Profile actually reports and never
// matching it. It also duplicated the real sync pipeline used elsewhere in the app
// (`syncReviewsForBusiness`, which fetches from the real provider and dedupes on
// `providerReviewId`), so the same business could end up with two independent, divergent
// review-import paths.
//
// Fix: route through the single real sync pipeline (`syncReviewsForBusiness`) so there is
// exactly one source of truth for importing reviews, no mock data, and no duplicate-insert path.
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const businessIdFromQuery = searchParams.get("businessId") ?? undefined;

    const ctx = await requireBusinessContext({ businessIdFromBody: businessIdFromQuery });
    if (!ctx.ok) return ctx.response;

    const result = await syncReviewsForBusiness(ctx.businessId, ctx.organizationId);

    return NextResponse.json({
      success: true,
      stats: { fetched: result.synced, total: result.analytics?.totalReviews ?? result.reviews.length },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
