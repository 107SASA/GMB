import { NextResponse } from 'next/server';
import { publicCatalog } from '@/lib/billing/planCatalog';

export const dynamic = 'force-dynamic';

/**
 * Public: the one sellable plan, for the pricing page and the audit-report
 * subscribe panel. `plans` (single-element array) is kept for callers that
 * still map over it.
 */
export async function GET() {
  const plan = await publicCatalog();
  return NextResponse.json({ success: true, plan, plans: [plan] });
}
