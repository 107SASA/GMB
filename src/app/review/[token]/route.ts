import { NextResponse } from 'next/server';
import { handleReviewRedirectByToken } from '@/lib/reviewRedirect';
import { GENERIC_REVIEW_REDIRECT, isLinkPreviewRequest } from '@/lib/reviewRequestFlow';
import { chooseReviewOpenMode, reviewOpenResponse } from '@/lib/reviewOpenInBrowser';

export const dynamic = 'force-dynamic';

/**
 * Customer tap target for the utility WhatsApp template.
 * Records the first click, then 302s to Google's Write a review page.
 * Inside WhatsApp's / Instagram's in-app browser (not signed in to Google)
 * it serves a tiny page that opens the same URL in Chrome instead
 * (see lib/reviewOpenInBrowser.ts). No Twilio or AI work happens here.
 *
 * The path is the ReviewRequest token. A query such as ?src=wa is ignored
 * and is not stored as part of the token.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const visit = { method: req.method, userAgent: req.headers.get('user-agent') };
    const url = await handleReviewRedirectByToken(token, visit);
    const isPreview = isLinkPreviewRequest(visit);
    if (isPreview || chooseReviewOpenMode(visit.userAgent, url) === 'redirect') {
      return NextResponse.redirect(url, 302);
    }
    return reviewOpenResponse(url, { userAgent: visit.userAgent, isPreview });
  } catch (error) {
    console.error('Review token redirect error:', error);
    return NextResponse.redirect(GENERIC_REVIEW_REDIRECT, 302);
  }
}
