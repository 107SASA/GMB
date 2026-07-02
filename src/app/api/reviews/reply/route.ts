import { NextResponse } from 'next/server';

// This route has been retired. Use /api/reviews/[id]/approve-reply then /api/reviews/[id]/post-reply.
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been removed. Use the approve-reply and post-reply routes.' },
    { status: 410 }
  );
}
