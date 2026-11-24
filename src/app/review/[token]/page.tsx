import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { findReviewRequestByToken, resolveClickedRedirect } from '@/lib/reviewRedirect';
import { GENERIC_REVIEW_REDIRECT } from '@/lib/reviewRequestFlow';
import { buildChromeIntentUrl, buildIosChromeUrl, buildIosSafariUrl, chooseReviewOpenMode } from '@/lib/reviewOpenInBrowser';
import { reviewPageContext } from '@/services/reviews/reviewAssist';
import ReviewAssistant, { type ReviewAssistantProps } from './ReviewAssistant';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Share your experience',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Customer tap target for the WhatsApp review request.
 *
 * Used to 302 straight to Google's "Write a review". Now it first shows the
 * review assistant (lib/reviewAssist.ts): tap stars → for 4–5 stars pick
 * what you liked and get an editable draft → copy and open Google. Every
 * rating gets the Google button (no review gating). The tap is recorded
 * exactly as before (link previews are not), and the hand-off to Chrome from
 * WhatsApp's in-app browser (lib/reviewOpenInBrowser.ts) happens on the
 * final button. An unknown token, or a business with no Place ID, still
 * redirects to the generic Google URL.
 */
async function load(token: string): Promise<ReviewAssistantProps | null> {
  const reviewRequest: any = await findReviewRequestByToken(token);
  if (!reviewRequest) return null;
  const h = await headers();
  const visit = { method: 'GET', userAgent: h.get('user-agent') };
  const reviewUrl = await resolveClickedRedirect(reviewRequest, visit);
  if (reviewUrl === GENERIC_REVIEW_REDIRECT) return null;
  const ctx = await reviewPageContext(reviewRequest);
  if (!ctx) return null;
  const mode = chooseReviewOpenMode(visit.userAgent, reviewUrl);
  return {
    token: reviewRequest.token,
    businessName: ctx.businessName,
    firstName: ctx.firstName,
    serviceChips: ctx.serviceChips,
    qualityChips: ctx.qualityChips,
    open: {
      mode,
      reviewUrl,
      chromeIntent: mode === 'android-chrome' ? buildChromeIntentUrl(reviewUrl) : null,
      iosChrome: mode === 'ios-choose' ? buildIosChromeUrl(reviewUrl) : null,
      iosSafari: mode === 'ios-choose' ? buildIosSafariUrl(reviewUrl) : null,
    },
  };
}

export default async function ReviewPage(props: PageProps<'/review/[token]'>) {
  const { token } = await props.params;
  let data: ReviewAssistantProps | null = null;
  try {
    data = await load(token);
  } catch (error) {
    console.error('Review page error:', error);
  }
  // redirect() throws, so it stays outside the try.
  if (!data) redirect(GENERIC_REVIEW_REDIRECT);
  return <ReviewAssistant {...data} />;
}
