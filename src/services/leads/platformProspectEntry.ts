import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { applyFormSignal } from '@/services/leadIntelligence/formSignals';

export interface FreeReportPlatformLeadInput {
  name: string;
  phone: string; // E.164 with '+'
  businessName: string;
}

/**
 * Upserts GrowwMatics platform Lead (tenant gmbboost-internal, Platform Prospect).
 * Does not apply form signals — callers apply FREE_REPORT_SUBMITTED / DEMO_REQUESTED
 * at the correct entry points.
 */
export async function upsertPlatformProspectLead(
  input: FreeReportPlatformLeadInput & {
    notes?: string;
    source?: string;
    ownershipActor?: string;
  }
): Promise<{ leadId: string; created: boolean }> {
  await dbConnect();
  const { name, phone, businessName } = input;
  const notes =
    input.notes ?? `Submitted the Free Business Report form for "${businessName}"`;
  const source = input.source ?? 'Website';
  const ownershipActor = input.ownershipActor ?? 'platform-prospect-entry';

  let lead = await Lead.findOne({ phone, tenantId: 'gmbboost-internal' });
  let created = false;
  if (lead) {
    if (!lead.name || lead.name === lead.phone) lead.name = name;
    if (!lead.source || lead.source === 'Website') lead.source = source;
    lead.leadType = 'Platform Prospect';
    if (!lead.businessType) lead.businessType = businessName;
    if (notes) lead.notes = notes;
    lead.lastActivityAt = new Date();
    await lead.save();
  } else {
    lead = await Lead.create({
      tenantId: 'gmbboost-internal',
      name,
      phone,
      source,
      leadType: 'Platform Prospect',
      businessType: businessName,
      notes,
      aiLeadScore: 60,
    });
    created = true;
  }

  const [{ setLeadOwnership }, { logLeadEvent }] = await Promise.all([
    import('@/services/leadOwnership/setLeadOwnership'),
    import('@/services/leadEvents'),
  ]);

  const owner = (lead.currentAgent || 'NONE') as string;
  if (owner === 'NONE' || owner === 'SALES') {
    await setLeadOwnership(lead._id, 'SALES', ownershipActor, ownershipActor, 'NURTURING').catch(
      (err: any) => console.warn('[platformProspect] setLeadOwnership failed:', err?.message)
    );
  }
  if (!lead.intent) {
    await Lead.updateOne({ _id: lead._id }, { $set: { intent: 'EXPLORING' } }).catch(() => {});
  }

  if (created) {
    await logLeadEvent(
      'LEAD_CREATED',
      { channel: source === 'Website' ? 'free-report' : source, businessName },
      ownershipActor,
      { leadId: lead._id, phone }
    );
  }

  return { leadId: String(lead._id), created };
}

/**
 * Free Report submit entry: upsert Lead immediately, then FREE_REPORT_SUBMITTED.
 * Audit may still be running — call linkPlatformLeadAudit when auditId is known.
 */
export async function fileFreeReportPlatformLead(
  input: FreeReportPlatformLeadInput
): Promise<{ leadId: string; created: boolean }> {
  const result = await upsertPlatformProspectLead({
    ...input,
    notes: `Submitted the Free Business Report form for "${input.businessName}"`,
    source: 'Website',
    ownershipActor: 'free-report-form',
  });

  await applyFormSignal(result.leadId, 'FREE_REPORT_SUBMITTED', 'free-report').catch((err: any) =>
    console.warn('[platformProspect] FREE_REPORT_SUBMITTED signal failed:', err?.message)
  );

  return result;
}

/** Attach Audit → Platform Lead when the audit id becomes available. */
export async function linkPlatformLeadAudit(
  leadId: string | mongoose.Types.ObjectId,
  auditId: string | mongoose.Types.ObjectId
): Promise<void> {
  if (!leadId || !auditId) return;
  if (!mongoose.isValidObjectId(String(leadId)) || !mongoose.isValidObjectId(String(auditId))) return;
  await dbConnect();
  await Lead.updateOne(
    { _id: leadId, tenantId: 'gmbboost-internal' },
    { $set: { auditId } }
  );
}

/**
 * Ensures a platform lead exists for a WhatsApp report-connect phone before nurture.
 * Does not apply FREE_REPORT_SUBMITTED (that is form-submit only).
 */
export async function ensurePlatformLeadForReportPhone(input: {
  phone: string;
  name?: string;
  businessName?: string;
}): Promise<string | null> {
  const phone = (input.phone || '').trim();
  if (!phone) return null;
  const name = (input.name || '').trim() || phone;
  const businessName = (input.businessName || '').trim() || name;
  const { leadId } = await upsertPlatformProspectLead({
    name,
    phone,
    businessName,
    notes: `Connected via WhatsApp report for "${businessName}"`,
    source: 'WhatsApp',
  });
  return leadId;
}
