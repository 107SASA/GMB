import { NextRequest, NextResponse } from "next/server";
import { handleReviewRedirect } from "@/lib/reviewRedirect";
import { isLinkPreviewRequest } from '@/lib/reviewRequestFlow';
import { reviewOpenResponse } from '@/lib/reviewOpenInBrowser';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const visit = { method: req.method, userAgent: req.headers.get('user-agent') };
    const url = await handleReviewRedirect(id, visit);
    return reviewOpenResponse(url, { userAgent: visit.userAgent, isPreview: isLinkPreviewRequest(visit) });
  } catch (error) {
    console.error("Tracking redirect error:", error);
    return NextResponse.redirect('https://google.com');
  }
}
