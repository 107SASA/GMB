import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { getActiveSeoPlan } from '@/services/seoPlan/seoPlanService';

export const dynamic = 'force-dynamic';

/** The active SEO-brain document for the current workspace. Powers the
 *  dashboard "SEO Plan" page. */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const plan = await getActiveSeoPlan(String(ctx.businessId));
  return NextResponse.json({ success: true, plan: plan ?? null });
}
