import { NextResponse, NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { changeCustomerLeadStage, findCustomerLeadMatch } from '@/services/crm/customerLeads';
import { normalizePhoneE164 } from '@/lib/phone';

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
    const gate = await requireModule(ctx.userId, 'sales_agent', ctx.businessId);
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
    if (has(data, 'name') && typeof data.name === 'string' && data.name.trim()) lead.name = data.name.trim().slice(0, 120);

    // Contact details (app "Edit lead"). A number / email that already belongs
    // to ANOTHER lead in this workspace is refused — merging is not automatic.
    if (has(data, 'phone')) {
      const raw = typeof data.phone === 'string' ? data.phone.trim() : '';
      const phone = raw ? normalizePhoneE164(raw) : null;
      if (raw && !phone) return NextResponse.json({ error: 'The phone number looks incomplete. Use a 10-digit number or +country format.' }, { status: 400 });
      if (lead.source === 'WhatsApp' && lead.phone && phone !== lead.phone) {
        return NextResponse.json({ error: "This number is linked to the lead's WhatsApp chat, so it can't be changed." }, { status: 400 });
      }
      if (phone && phone !== lead.phone) {
        const other = await findCustomerLeadMatch(ctx.businessId, phone, null);
        if (other && String(other._id) !== String(lead._id)) {
          return NextResponse.json({ error: `This number already belongs to another lead (${other.name}).`, code: 'DUPLICATE_PHONE' }, { status: 409 });
        }
      }
      lead.phone = phone ?? undefined;
    }
    if (has(data, 'email')) {
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'The email address looks wrong.' }, { status: 400 });
      if (email && email !== lead.email) {
        const other = await findCustomerLeadMatch(ctx.businessId, null, email);
        if (other && String(other._id) !== String(lead._id)) {
          return NextResponse.json({ error: `This email already belongs to another lead (${other.name}).`, code: 'DUPLICATE_EMAIL' }, { status: 409 });
        }
      }
      lead.email = email || undefined;
    }
    if (has(data, 'city')) lead.city = typeof data.city === 'string' ? data.city.trim().slice(0, 100) || undefined : undefined;
    if (has(data, 'businessCard') && data.businessCard && typeof data.businessCard === 'object') {
      const card: any = lead.businessCard ? (lead.businessCard.toObject?.() ?? { ...lead.businessCard }) : {};
      const limits: Record<string, number> = { company: 200, designation: 200, website: 300, address: 500, metAt: 200 };
      for (const [k, max] of Object.entries(limits)) {
        if (has(data.businessCard, k)) {
          const v = typeof data.businessCard[k] === 'string' ? data.businessCard[k].trim().slice(0, max) : '';
          if (v) card[k] = v;
          else delete card[k];
        }
      }
      // Saving the edit form = the owner has checked the details.
      if (has(data.businessCard, 'needsReview')) card.needsReview = !!data.businessCard.needsReview;
      lead.businessCard = card;
    }
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
