import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { rollbackChange } from '@/services/gbp/changes/store';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const result = await rollbackChange(id, { userId: auth.userId, businessId: auth.businessId });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error, change: 'change' in result ? result.change : null }, { status: 409 });
  return NextResponse.json({ success: true, change: result.change });
}
