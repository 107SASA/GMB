import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { applyActivePlanToProfile } from '@/services/seoPlan/applyPlan';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  fields: z.array(z.enum(['title', 'description'])).optional(),
});

/**
 * Apply the active plan's title/description drafts. Mirrors into the local
 * Business record always; a live Google write only fires when
 * GBP_LIVE_WRITES_ENABLED is on and the workspace is OAuth-connected (the
 * response `reason` says which happened).
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const fields = parsed.success ? parsed.data.fields : undefined;

  try {
    const result = await applyActivePlanToProfile(String(ctx.businessId), { fields });
    return NextResponse.json({ success: result.applied, ...result });
  } catch (err: any) {
    console.error('[seo-plan/apply] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not apply the plan. Please try again or contact support.' },
      { status: 500 },
    );
  }
}
