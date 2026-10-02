import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import FollowUp from '@/models/FollowUp';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { createFollowUpTask } from '@/services/crm/followUps';

const STATUSES = ['pending', 'completed', 'cancelled'];

/**
 * Customer CRM follow-up TASKS for the active workspace (businessId — never
 * the organization, so another workspace's tasks are invisible).
 * ?leadId= one lead's tasks · ?status=pending|completed|cancelled · ?due=1
 * pending tasks due by end of today (or overdue).
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();
    const url = new URL(req.url);
    const filter: Record<string, unknown> = {
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      kind: 'task',
    };
    const leadId = url.searchParams.get('leadId');
    if (leadId) {
      if (!mongoose.isValidObjectId(leadId)) return NextResponse.json({ success: true, followUps: [] });
      filter.leadId = new mongoose.Types.ObjectId(leadId);
    }
    const status = url.searchParams.get('status');
    if (status && STATUSES.includes(status)) filter.status = status;
    if (url.searchParams.get('due') === '1') {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filter.status = 'pending';
      filter.scheduledFor = { $lte: end };
    }

    const followUps = await FollowUp.find(filter)
      .populate('leadId', 'name phone lifeCycleStage subStage')
      .sort({ status: -1, scheduledFor: 1 })
      .limit(500)
      .lean();

    return NextResponse.json({ success: true, followUps });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

/** Create a task: { leadId, dueAt, type: Call|WhatsApp|Email|Meeting|Other, note?, assignedUserId? } */
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const data = await req.json().catch(() => ({}));
    const r = await createFollowUpTask({
      businessId: ctx.businessId,
      organizationId: ctx.organizationId,
      leadId: String(data.leadId || ''),
      dueAt: new Date(data.dueAt),
      type: data.type,
      note: typeof data.note === 'string' ? data.note.trim() : null,
      assignedUserId: data.assignedUserId || null,
      createdBy: ctx.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ success: true, followUp: r.followUp }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
