import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { markTaskDone } from '@/services/tasks/taskService';

export const dynamic = 'force-dynamic';

/** "I've done this" — for work done outside GrowwMatics. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const result = await markTaskDone(auth.businessId, id, auth.userId);
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, task: result.task });
}
