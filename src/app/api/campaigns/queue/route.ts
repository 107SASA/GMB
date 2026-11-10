import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { businessQueueStatus } from '@/services/reviews/campaignQueue';

export const dynamic = 'force-dynamic';

/** Review-request queue progress for the Reviews screen (web + apps). */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  try {
    return NextResponse.json({ success: true, ...(await businessQueueStatus(ctx.businessId)) });
  } catch (error: any) {
    console.error('[campaigns/queue] failed:', error?.message);
    return NextResponse.json({ success: false, message: 'Could not load the queue' }, { status: 500 });
  }
}
