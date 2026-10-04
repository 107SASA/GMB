import { NextResponse } from 'next/server';
import { handleReviewRedirectByToken } from '@/lib/reviewRedirect';
import { GENERIC_REVIEW_REDIRECT } from '@/lib/reviewRequestFlow';

export const dynamic = 'force-dynamic';

/**
 * Customer tap target for the utility WhatsApp template.
 * Records the first click, then 302s to Google's Write a review page.
 * No page is rendered. No Twilio or AI work happens here.
 *
 * The path is the ReviewRequest token. A query such as ?src=wa is ignored
 * and is not stored as part of the token.
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const url = await handleReviewRedirectByToken(token);
    return NextResponse.redirect(url, 302);
  } catch (error) {
    console.error('Review token redirect error:', error);
    return NextResponse.redirect(GENERIC_REVIEW_REDIRECT, 302);
  }
}
