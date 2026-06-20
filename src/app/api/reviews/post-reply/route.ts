import { NextResponse } from 'next/server';

// This flat route has been retired. Use /api/reviews/[id]/post-reply instead.
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been removed. Use POST /api/reviews/{id}/post-reply.' },
    { status: 410 }
  );
}
