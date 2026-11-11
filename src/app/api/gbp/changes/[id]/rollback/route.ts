import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { rollbackChange } from '@/services/gbp/changes/store';
import { requireWorkspacePlan } from '@/lib/planGate';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  // Paid feature: this workspace needs its own plan (lib/planGate.ts).
  const planGate = await requireWorkspacePlan(auth.userId, auth.businessId);
  if (!planGate.ok) return planGate.response;
  const { id } = await ctx.params;
  const result = await rollbackChange(id, { userId: auth.userId, businessId: auth.businessId });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error, change: 'change' in result ? result.change : null }, { status: 409 });
  return NextResponse.json({ success: true, change: result.change });
}
