import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { approveChange } from '@/services/gbp/changes/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await approveChange(id, { userId: auth.userId, businessId: auth.businessId }, body?.confirmSensitive === true);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, change: result.change, liveWriteApplied: false });
}
