import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { getTaskList } from '@/services/tasks/taskService';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/** The active workspace's plan tasks (web dashboard, Android and iOS). */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  try {
    const list = await getTaskList(ctx.businessId);
    return NextResponse.json({ success: true, ...list });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
