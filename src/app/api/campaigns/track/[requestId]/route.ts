import { NextResponse } from 'next/server';
import { handleReviewRedirect } from '@/lib/reviewRedirect';
import { isLinkPreviewRequest } from '@/lib/reviewRequestFlow';
import { reviewOpenResponse } from '@/lib/reviewOpenInBrowser';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;
    const visit = { method: req.method, userAgent: req.headers.get('user-agent') };
    const url = await handleReviewRedirect(requestId, visit);
    return reviewOpenResponse(url, { userAgent: visit.userAgent, isPreview: isLinkPreviewRequest(visit) });
  } catch (error: any) {
    console.error('Tracking Error:', error);
    return NextResponse.redirect('https://google.com');
  }
}
