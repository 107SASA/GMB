import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { discardChange } from '@/services/gbp/changes/store';

export const dynamic = 'force-dynamic';

/** Drops a proposal that was never sent to Google. Nothing is written to Google. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const result = await discardChange(id, { userId: auth.userId, businessId: auth.businessId });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 409 });
  return NextResponse.json({ success: true, change: result.change, liveWriteApplied: false });
}
