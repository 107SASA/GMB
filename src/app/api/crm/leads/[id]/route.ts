import { NextResponse, NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Activity from '@/models/Activity';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const resolvedParams = await params;
    const { id } = resolvedParams;
    const data = await req.json();
    await dbConnect();

    // Scope the lookup to the verified business so a user can't patch another
    // tenant's lead by guessing a lead _id
    const lead = await Lead.findOne({ _id: id, businessId: ctx.businessId });
    if (!lead) return NextResponse.json({ error: 'Lead not found or unauthorized' }, { status: 404 });

    const oldStage = lead.pipelineStage;
    const oldLifeCycleStage = lead.lifeCycleStage;

    if (Object.prototype.hasOwnProperty.call(data, 'pipelineStage')) lead.pipelineStage = data.pipelineStage;
    if (Object.prototype.hasOwnProperty.call(data, 'notes')) lead.notes = data.notes;
    if (Object.prototype.hasOwnProperty.call(data, 'status')) lead.status = data.status;
    if (Object.prototype.hasOwnProperty.call(data, 'tags')) lead.tags = data.tags;
    if (Object.prototype.hasOwnProperty.call(data, 'lifeCycleStage')) lead.lifeCycleStage = data.lifeCycleStage;
    if (Object.prototype.hasOwnProperty.call(data, 'subStage')) {
      lead.subStage = data.subStage;
    } else if (Object.prototype.hasOwnProperty.call(data, 'lifeCycleStage') && data.lifeCycleStage !== oldLifeCycleStage) {
      // Sub-stages belong to a main stage; a stage move invalidates the old one
      lead.subStage = null;
    }

    lead.lastActivityAt = new Date();
    await lead.save();

    if (Object.prototype.hasOwnProperty.call(data, 'pipelineStage') && data.pipelineStage !== oldStage) {
      await Activity.create({
        tenantId: ctx.organizationId,
        leadId: lead._id,
        type: 'status_change',
        content: `Moved from ${oldStage || 'Unassigned'} to ${data.pipelineStage || 'Unassigned'}`,
      });
    }

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
