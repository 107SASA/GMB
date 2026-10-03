import { NextResponse, NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { changeCustomerLeadStage } from '@/services/crm/customerLeads';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * PATCH /api/crm/leads/[id] — Customer CRM lead update (web + app).
 *
 * Stage moves go through changeCustomerLeadStage (the canonical stage model):
 *   { lifeCycleStage, subStageId? | subStage? }   — current web + app
 *   { pipelineStage }                              — LEGACY app builds only
 * Moving to CONVERTED needs { deal: { value, currency, closedAt?, notes? } }
 * (422 DEAL_VALUE_REQUIRED otherwise) — legacy clients excepted.
 * { deal } alone on an already-converted lead records/edits the deal value.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const data = await req.json().catch(() => ({}));
    await dbConnect();

    // Scope the lookup to the verified business so a user can't patch another
    // workspace's lead by guessing a lead _id
    const lead: any = await Lead.findOne({ _id: id, businessId: ctx.businessId }).catch(() => null);
    if (!lead) return NextResponse.json({ error: 'Lead not found or unauthorized' }, { status: 404 });

    if (has(data, 'notes')) lead.notes = data.notes;
    if (has(data, 'interest')) lead.interest = data.interest;
    if (has(data, 'status') && ['active', 'inactive'].includes(data.status)) lead.status = data.status;
    if (has(data, 'tags') && Array.isArray(data.tags)) lead.tags = data.tags.map(String).slice(0, 20);
    if (has(data, 'name') && typeof data.name === 'string' && data.name.trim()) lead.name = data.name.trim();
    lead.lastActivityAt = new Date();
    await lead.save();

    const stageRequested = has(data, 'lifeCycleStage') || has(data, 'subStageId') || has(data, 'subStage') || has(data, 'pipelineStage') || has(data, 'deal');
    if (stageRequested) {
      const legacy = !has(data, 'lifeCycleStage') && !has(data, 'subStageId') && !has(data, 'subStage') && has(data, 'pipelineStage');
      const dealOnly = has(data, 'deal') && !has(data, 'lifeCycleStage') && !has(data, 'subStageId') && !has(data, 'subStage') && !has(data, 'pipelineStage');
      const r = await changeCustomerLeadStage({
        businessId: ctx.businessId,
        leadId: id,
        userId: ctx.userId,
        lifeCycleStage: dealOnly ? lead.lifeCycleStage : (has(data, 'lifeCycleStage') ? data.lifeCycleStage : undefined),
        subStageId: dealOnly ? lead.subStageId : (has(data, 'subStageId') ? data.subStageId : undefined),
        subStage: dealOnly ? lead.subStage : (has(data, 'subStage') ? data.subStage : undefined),
        ...(legacy ? { legacyColumn: data.pipelineStage } : {}),
        deal: data.deal ?? null,
        legacy,
      });
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      return NextResponse.json({ success: true, lead: r.lead });
    }

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
