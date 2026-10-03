import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { updateFollowUpTask } from '@/services/crm/followUps';

/** { action: 'complete' | 'cancel' | 'reschedule', dueAt?, note? } — this workspace's tasks only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const data = await req.json().catch(() => ({}));
    if (!['complete', 'cancel', 'reschedule'].includes(data.action)) {
      return NextResponse.json({ error: 'action must be complete, cancel or reschedule' }, { status: 400 });
    }
    const r = await updateFollowUpTask({
      businessId: ctx.businessId,
      followUpId: id,
      userId: ctx.userId,
      action: data.action,
      dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
      note: typeof data.note === 'string' ? data.note.trim() : null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ success: true, followUp: r.followUp });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
