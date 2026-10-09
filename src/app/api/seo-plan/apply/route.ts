import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { applyActivePlanToProfile } from '@/services/seoPlan/applyPlan';

export const dynamic = 'force-dynamic';

/**
 * Creates a description proposal from the active SEO plan.
 * Does not write to Google and does not change the business name.
 */
export async function POST() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    const result = await applyActivePlanToProfile(String(ctx.businessId));
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[seo-plan/apply] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not propose the plan. Please try again or contact support.' },
      { status: 500 },
    );
  }
}
