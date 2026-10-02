import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { dismissCall, linkCallToLead, saveCallAsLead, type CallActionResult } from '@/services/crm/calls';

/**
 * Owner's answer to "Save this caller?":
 *   { action: 'save', name?, notes?, createCallbackTask? } → new lead (source Phone Call), or the existing one with this number
 *   { action: 'link', leadId }                              → attach to an existing lead
 *   { action: 'dismiss' }                                   → not a lead
 * Never messages the caller.
 */
export async function POST(
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
    let r: CallActionResult;
    if (data.action === 'save') {
      r = await saveCallAsLead({
        businessId: ctx.businessId,
        organizationId: ctx.organizationId,
        callEventId: id,
        userId: ctx.userId,
        name: typeof data.name === 'string' ? data.name.trim() : null,
        notes: typeof data.notes === 'string' ? data.notes.trim() : null,
        createCallbackTask: data.createCallbackTask === true,
      });
    } else if (data.action === 'link') {
      r = await linkCallToLead({ businessId: ctx.businessId, callEventId: id, leadId: String(data.leadId || ''), userId: ctx.userId });
    } else if (data.action === 'dismiss') {
      r = await dismissCall({ businessId: ctx.businessId, callEventId: id, userId: ctx.userId });
    } else {
      return NextResponse.json({ error: 'action must be save, link or dismiss' }, { status: 400 });
    }
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ success: true, callEvent: r.callEvent, lead: r.lead ?? null, created: r.created ?? false });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
