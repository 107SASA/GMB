import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { applyFormSignal } from '@/services/leadIntelligence/formSignals';
import { PLACEHOLDER_PERSON_NAME, usablePersonName } from '@/lib/personName';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';

export interface FreeReportPlatformLeadInput {
  name: string;
  phone: string; // E.164 with '+'
  businessName: string;
  /** Where the free report was requested (default: the website form). */
  channel?: 'website' | 'whatsapp';
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
  const source = input.source ?? 'Website Free Report';
  const ownershipActor = input.ownershipActor ?? 'platform-prospect-entry';

  const incomingName = usablePersonName(name, businessName) || businessName.trim() || name.trim();
  let lead = await Lead.findOne({ phone, tenantId: 'gmbboost-internal' });
  let created = false;
  if (lead) {
    // Replace a missing name, a phone-as-name, the "New User" placeholder, or
    // a business-name fallback. A real person name already on the lead is left alone.
    if (!usablePersonName(lead.name, lead.businessType || businessName)) lead.name = incomingName;
    // The first channel stays the source; a placeholder one is replaced.
    const { PLACEHOLDER_SOURCES } = await import('@/services/leads/captureSource');
    if (PLACEHOLDER_SOURCES.has(lead.source || '')) lead.source = source;
    lead.leadType = 'Platform Prospect';
    if (!lead.businessType) lead.businessType = businessName;
    if (notes) lead.notes = notes;
    lead.lastActivityAt = new Date();
    await lead.save();
  } else {
    lead = await Lead.create({
      tenantId: 'gmbboost-internal',
      name: incomingName,
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
      { channel: source, businessName },
      ownershipActor,
      { leadId: lead._id, phone }
    );
  }
  const { recordCaptureSource } = await import('@/services/leads/captureSource');
  await recordCaptureSource(lead, source, { created, detail: { businessName } });

  return { leadId: String(lead._id), created };
}

/**
 * Free Report submit entry: upsert Lead immediately, then FREE_REPORT_SUBMITTED.
 * Audit may still be running — call linkPlatformLeadAudit when auditId is known.
 */
export async function fileFreeReportPlatformLead(
  input: FreeReportPlatformLeadInput
): Promise<{ leadId: string; created: boolean }> {
  const whatsapp = input.channel === 'whatsapp';
  const result = await upsertPlatformProspectLead({
    ...input,
    notes: whatsapp
      ? `Asked for the free Business Report on WhatsApp for "${input.businessName}"`
      : `Submitted the Free Business Report form for "${input.businessName}"`,
    source: whatsapp ? 'WhatsApp Free Report' : 'Website Free Report',
    ownershipActor: whatsapp ? 'whatsapp-free-report' : 'free-report-form',
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

/**
 * Copies a name the person typed themselves (checkout / profile) onto their
 * platform lead and their sales / booking WhatsApp threads, so the super
 * admin CRM and later messages stop using "New User" or the business name.
 * `businessNames` are the user's workspaces — any of them may have been used
 * as the fallback name. A real person name already there is left alone.
 */
export async function syncPlatformLeadName(phone: string, fullName: string, businessNames: string[] = []): Promise<void> {
  const name = usablePersonName(fullName);
  const normalized = normalizePhoneE164(phone) || phone;
  if (!name || !normalized) return;
  await dbConnect();
  const fallbacks = businessNames.map((b) => b.trim()).filter(Boolean);
  const isFallback = (value: unknown, businessType?: string) => {
    const current = usablePersonName(value, businessType);
    return !current || fallbacks.some((b) => b.toLowerCase() === current.toLowerCase());
  };

  const lead = await Lead.findOne({ phone: normalized, tenantId: 'gmbboost-internal' });
  if (lead && isFallback(lead.name, lead.businessType)) {
    lead.name = name;
    await lead.save();
  }

  const key = phoneDedupeKey(normalized);
  if (!key) return;
  const placeholders = ['', PLACEHOLDER_PERSON_NAME, ...fallbacks];
  const [{ default: SalesConversation }, { default: BookingConversation }] = await Promise.all([
    import('@/models/SalesConversation'),
    import('@/models/BookingConversation'),
  ]);
  await Promise.all([
    SalesConversation.updateMany({ phoneKey: key, leadName: { $in: placeholders } }, { $set: { leadName: name } }),
    BookingConversation.updateMany({ phoneKey: key, leadName: { $in: placeholders } }, { $set: { leadName: name } }),
    BookingConversation.updateMany({ phoneKey: key, 'details.name': { $in: placeholders } }, { $set: { 'details.name': name } }),
  ]);
}
