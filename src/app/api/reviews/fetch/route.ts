import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { syncReviewsForBusiness } from '@/services/reviews/syncReviews';

export async function POST(req: Request) {
  try {
    const { businessId } = await req.json();

    const ctx = await requireBusinessContext({ businessIdFromBody: businessId });
    if (!ctx.ok) return ctx.response;

    // Review Management uses the OFFICIAL Google Business Profile API only, because
    // posting replies back to Google requires real Google review IDs (the SerpApi
    // scrape can't do that). If the workspace hasn't connected Google yet, ask
    // them to connect rather than silently falling back to a read-only scrape.
    if (!ctx.business.googleConnected) {
      return NextResponse.json({
        success: false,
        needsConnection: true,
        error: 'Connect your Google Business Profile to sync and reply to reviews.',
      });
    }

    await dbConnect();

    const result = await syncReviewsForBusiness(ctx.businessId, ctx.organizationId, { requireGbp: true });

    return NextResponse.json({
      success: true,
      synced: result.synced,
      analytics: result.analytics,
      reviews: result.reviews,
    });
  } catch (error: any) {
    console.error('[reviews/fetch] Failed to sync reviews:', error);
    const raw = String(error?.message || '');
    // Turn Google's raw API errors into something a business owner can act on;
    // the full error is still in the server log above.
    let message = raw || 'Could not sync reviews. Please try again.';
    if (/SERVICE_DISABLED|has not been used in project|mybusiness\.googleapis\.com/i.test(raw)) {
      message = 'Google review sync needs the "Google My Business API" enabled in the Google Cloud project. Enable it, wait a few minutes, then try again.';
    } else if (/PERMISSION_DENIED|\b403\b/.test(raw)) {
      message = 'Google denied access to reviews. The Google Business Profile (v4) API must be enabled and approved for this project — then reconnect Google.';
    } else if (/GBPAuthError|reconnect/i.test(raw)) {
      message = 'Your Google connection expired — please reconnect Google Business Profile.';
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
