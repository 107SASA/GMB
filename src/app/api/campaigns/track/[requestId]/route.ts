import { NextResponse } from 'next/server';
import { handleReviewRedirect } from '@/lib/reviewRedirect';

export async function GET(
  _: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;
    const url = await handleReviewRedirect(requestId);
    return NextResponse.redirect(url);
  } catch (error: any) {
    console.error('Tracking Error:', error);
    return NextResponse.redirect('https://google.com');
  }
}
