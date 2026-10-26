import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import User from '@/models/User';
import { normalizePhoneE164 } from '@/lib/phone';
import { logLeadEvent } from '@/services/leadEvents';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';
import {
  CRM_SOURCES,
  crmStageDef,
  normaliseCrmImportRow,
  parseCrmSource,
  type CrmImportRow,
  type CrmStage,
} from '@/lib/admin/platformCrm';

/**
 * Super admin CRM writes. Every change is recorded on the lead's timeline
 * (LeadEvent) with the team member as the actor, so the lead page shows who
 * changed what, next to what the AI and the customer said.
 *
 * Stages are the Lead Engine's own `currentStage`. A stage change keeps the
 * AI consistent with it:
 *  - Customer      → owned in-house (sales and demo threads stand down)
 *  - Lost / Do not contact → queued automated messages are cancelled; do not
 *    contact also stops nurture. Every automated send re-checks these.
 *  - leaving Customer → back to the Sales agent
 *  - anything else → the stage only; whoever owns the lead keeps it.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; status: number; error: string; leadId?: string };

const EDITABLE_TEXT = ['name', 'email', 'businessType', 'city', 'interest', 'lostReason'] as const;
const NURTURE_SETTABLE = ['ACTIVE', 'PAUSED', 'STOPPED'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function platformLead(id: string): Promise<any | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Lead.findOne({ _id: id, tenantId: PLATFORM_TENANT });
}

async function isSuperAdmin(userId: unknown): Promise<boolean> {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  return !!(await User.exists({ _id: userId, role: 'SUPER_ADMIN' }));
}

/** Moves a lead to `stage` with the side effects the AI relies on. Records STAGE_CHANGED. */
async function applyStage(lead: any, stage: CrmStage, actorId: string, reason?: string): Promise<void> {
  const from = lead.currentStage || 'NEW';
  if (from === stage) return;
  // A sub-stage belongs to one main stage — it doesn't follow the lead to another.
  const current: any = await Lead.findById(lead._id).select('subStageId').lean();
  if (current?.subStageId) {
    const { getPlatformSubStages } = await import('@/services/admin/platformCrmActivity');
    const sub = (await getPlatformSubStages()).find((x) => x.id === current.subStageId);
    if (!sub || sub.stage !== stage) await Lead.updateOne({ _id: lead._id }, { $set: { subStageId: null, subStage: null } });
  }
  const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
  if (stage === 'CUSTOMER') {
    await setLeadOwnership(lead._id, 'IN_HOUSE', 'crm-stage', actorId, 'CUSTOMER');
  } else if (from === 'CUSTOMER' && lead.currentAgent === 'IN_HOUSE') {
    await setLeadOwnership(lead._id, 'SALES', 'crm-stage', actorId, stage);
  } else {
    const set: Record<string, unknown> = { currentStage: stage };
    if (stage === 'DO_NOT_CONTACT') set.nurtureStatus = 'STOPPED';
    if (stage === 'LOST') set.lostAt = new Date();
    await Lead.updateOne({ _id: lead._id }, { $set: set });
  }
  if (stage === 'LOST' || stage === 'DO_NOT_CONTACT') {
    const { cancelScheduledActions } = await import('@/services/scheduler/cancelScheduledActions');
    await cancelScheduledActions(lead._id, `crm-stage-${stage.toLowerCase()}`);
  }
  await logLeadEvent('STAGE_CHANGED', { from, to: stage, by: 'team', ...(reason ? { reason } : {}) }, actorId, { leadId: lead._id, phone: lead.phone });
}

export async function createPlatformLead(
  input: { name?: string; phone?: string; email?: string; businessType?: string; city?: string; source?: string; stage?: string; tags?: string[]; notes?: string },
  actorId: string
): Promise<Result<{ leadId: string }>> {
  await dbConnect();
  const phone = normalizePhoneE164(String(input.phone || ''));
  if (!phone) return { ok: false, status: 400, error: 'A valid phone number is required.' };
  const name = String(input.name || '').trim();
  const business = String(input.businessType || '').trim();
  if (!name && !business) return { ok: false, status: 400, error: 'Enter a name or a business name.' };
  const email = String(input.email || '').trim();
  if (email && !EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'That email is not valid.' };
  const stage = input.stage ? crmStageDef(input.stage) : crmStageDef('NEW');
  if (!stage || !stage.settable) return { ok: false, status: 400, error: 'Unknown stage.' };

  const existing: any = await Lead.findOne({ tenantId: PLATFORM_TENANT, phone }).select('_id').lean();
  if (existing) return { ok: false, status: 409, error: 'A lead with this phone number already exists.', leadId: String(existing._id) };

  const lead = await Lead.create({
    tenantId: PLATFORM_TENANT,
    leadType: 'Platform Prospect',
    name: name || business,
    phone,
    email: email || undefined,
    businessType: business || undefined,
    city: String(input.city || '').trim() || undefined,
    source: parseCrmSource(input.source, 'Manual'),
    captureSources: [parseCrmSource(input.source, 'Manual')],
    tags: (input.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20),
    currentStage: stage.value === 'CUSTOMER' ? 'NEW' : stage.value,
  });
  await logLeadEvent('LEAD_CREATED', { source: lead.source, by: 'team' }, actorId, { leadId: lead._id, phone });
  if (stage.value === 'CUSTOMER') await applyStage(lead, 'CUSTOMER', actorId);
  if (input.notes && String(input.notes).trim()) {
    await logLeadEvent('NOTE_ADDED', { text: String(input.notes).trim().slice(0, 2000) }, actorId, { leadId: lead._id, phone });
  }
  return { ok: true, leadId: String(lead._id) };
}

export async function updatePlatformLead(id: string, patch: Record<string, unknown>, actorId: string): Promise<Result> {
  await dbConnect();
  const lead = await platformLead(id);
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };

  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  const changed: string[] = [];

  for (const field of EDITABLE_TEXT) {
    if (!(field in patch)) continue;
    const value = String(patch[field] ?? '').trim();
    if (field === 'name' && !value) return { ok: false, status: 400, error: 'Name cannot be empty.' };
    if (field === 'email' && value && !EMAIL_RE.test(value)) return { ok: false, status: 400, error: 'That email is not valid.' };
    if (value === String(lead[field] ?? '')) continue;
    if (value) set[field] = value.slice(0, field === 'lostReason' ? 500 : 200);
    else unset[field] = '';
    changed.push(field);
  }
  if ('phone' in patch) {
    const phone = normalizePhoneE164(String(patch.phone || ''));
    if (!phone) return { ok: false, status: 400, error: 'A valid phone number is required.' };
    if (phone !== lead.phone) {
      if (await Lead.exists({ tenantId: PLATFORM_TENANT, phone, _id: { $ne: lead._id } })) {
        return { ok: false, status: 409, error: 'Another lead already has this phone number.' };
      }
      set.phone = phone;
      changed.push('phone');
    }
  }
  if ('source' in patch) {
    if (!CRM_SOURCES.includes(patch.source as any)) return { ok: false, status: 400, error: 'Unknown source.' };
    if (patch.source !== lead.source) { set.source = patch.source; changed.push('source'); }
  }
  if ('tags' in patch) {
    if (!Array.isArray(patch.tags)) return { ok: false, status: 400, error: 'Tags must be a list.' };
    const tags = (patch.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
    if (JSON.stringify(tags) !== JSON.stringify(lead.tags || [])) { set.tags = tags; changed.push('tags'); }
  }
  if ('assignedUserId' in patch) {
    const a = patch.assignedUserId;
    if (a === null || a === '') {
      if (lead.assignedUserId) { unset.assignedUserId = ''; changed.push('assignedUserId'); }
    } else if (!(await isSuperAdmin(a))) {
      return { ok: false, status: 400, error: 'Assign the lead to a team member (super admin).' };
    } else if (String(a) !== String(lead.assignedUserId || '')) {
      set.assignedUserId = a;
      changed.push('assignedUserId');
    }
  }
  if ('nurtureStatus' in patch) {
    if (lead.nurtureStatus === 'OPTED_OUT') return { ok: false, status: 409, error: 'This person opted out — only they can opt back in.' };
    if (!NURTURE_SETTABLE.includes(patch.nurtureStatus as any)) return { ok: false, status: 400, error: 'Unknown nurture status.' };
    if (patch.nurtureStatus !== lead.nurtureStatus) { set.nurtureStatus = patch.nurtureStatus; changed.push('nurtureStatus'); }
  }
  if ('dealValue' in patch) {
    const raw = patch.dealValue;
    const value = raw === null || raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return { ok: false, status: 400, error: 'Deal value must be a positive number.' };
    if (value !== (lead.deal?.value ?? null)) {
      set.deal = value === null ? null : { ...(lead.deal?.toObject?.() ?? lead.deal ?? {}), value, currency: 'INR', recordedBy: actorId };
      changed.push('dealValue');
    }
  }

  if ('subStageId' in patch) {
    const id = patch.subStageId;
    if (id === null || id === '') {
      if (lead.subStageId) { set.subStageId = null; set.subStage = null; changed.push('subStage'); }
    } else {
      const { getPlatformSubStages } = await import('@/services/admin/platformCrmActivity');
      const sub = (await getPlatformSubStages()).find((x) => x.id === id);
      const targetStage = (typeof patch.stage === 'string' && patch.stage) || lead.currentStage;
      if (!sub) return { ok: false, status: 400, error: 'Unknown sub-stage.' };
      if (sub.stage !== targetStage) return { ok: false, status: 400, error: `"${sub.name}" belongs to another stage.` };
      if (sub.id !== lead.subStageId) { set.subStageId = sub.id; set.subStage = sub.name; changed.push('subStage'); }
    }
  }

  let stage: CrmStage | null = null;
  if ('stage' in patch) {
    const def = crmStageDef(patch.stage);
    if (!def || !def.settable) return { ok: false, status: 400, error: 'Unknown stage.' };
    if (def.value !== lead.currentStage) stage = def.value;
  }

  if (changed.length) {
    await Lead.updateOne({ _id: lead._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (set.nurtureStatus === 'STOPPED' || set.nurtureStatus === 'PAUSED') {
      const { cancelGenericSalesActions } = await import('@/services/sales/preSalesPolicy');
      await cancelGenericSalesActions(lead._id, `crm-nurture-${String(set.nurtureStatus).toLowerCase()}`);
    }
    await logLeadEvent('LEAD_UPDATED', { fields: changed, by: 'team' }, actorId, { leadId: lead._id, phone: (set.phone as string) || lead.phone });
  }
  if (stage) await applyStage(lead, stage, actorId, typeof patch.lostReason === 'string' ? patch.lostReason : undefined);
  return { ok: true };
}

export async function addPlatformLeadNote(id: string, text: unknown, actorId: string): Promise<Result> {
  await dbConnect();
  const lead = await platformLead(id);
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  const note = String(text ?? '').trim();
  if (!note) return { ok: false, status: 400, error: 'The note is empty.' };
  await logLeadEvent('NOTE_ADDED', { text: note.slice(0, 2000) }, actorId, { leadId: lead._id, phone: lead.phone });
  await Lead.updateOne({ _id: lead._id }, { $set: { lastContactedAt: new Date() } });
  return { ok: true };
}

/** Moves many leads to one stage (same rules as a single change). */
export async function bulkStagePlatformLeads(ids: unknown, stage: unknown, actorId: string): Promise<Result<{ updated: number; skipped: number }>> {
  await dbConnect();
  const def = crmStageDef(stage);
  if (!def || !def.settable) return { ok: false, status: 400, error: 'Unknown stage.' };
  if (!Array.isArray(ids) || !ids.length) return { ok: false, status: 400, error: 'Select at least one lead.' };
  if (ids.length > 500) return { ok: false, status: 400, error: 'Move at most 500 leads at once.' };
  let updated = 0;
  let skipped = 0;
  for (const id of ids) {
    const lead = await platformLead(String(id));
    if (!lead || lead.currentStage === def.value) { skipped++; continue; }
    await applyStage(lead, def.value, actorId);
    updated++;
  }
  return { ok: true, updated, skipped };
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

/**
 * Files spreadsheet rows as platform leads. New numbers become new leads.
 * A number already in the CRM only gets its EMPTY fields filled (never
 * overwritten) and new tags merged — and its stage changed only when
 * `updateStages` is on. Duplicate numbers inside the file keep the first row.
 */
export async function importPlatformLeads(rawRows: Record<string, unknown>[], actorId: string, opts: { updateStages?: boolean } = {}): Promise<ImportSummary> {
  await dbConnect();
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };
  const rows: { line: number; row: CrmImportRow }[] = [];
  const seen = new Set<string>();
  rawRows.forEach((raw, i) => {
    const line = i + 2; // header is line 1
    const parsed = normaliseCrmImportRow(raw);
    if (!parsed.ok) { summary.errors.push({ row: line, error: parsed.error }); return; }
    if (seen.has(parsed.row.phone)) { summary.skipped++; summary.errors.push({ row: line, error: 'same phone as an earlier row — skipped' }); return; }
    seen.add(parsed.row.phone);
    rows.push({ line, row: parsed.row });
  });

  const existing: any[] = await Lead.find({ tenantId: PLATFORM_TENANT, phone: { $in: rows.map((r) => r.row.phone) } });
  const byPhone = new Map(existing.map((l) => [l.phone, l]));

  for (const { line, row } of rows) {
    try {
      const lead = byPhone.get(row.phone);
      if (!lead) {
        const created = await Lead.create({
          tenantId: PLATFORM_TENANT,
          leadType: 'Platform Prospect',
          name: row.name,
          phone: row.phone,
          email: row.email,
          businessType: row.businessType,
          city: row.city,
          source: row.source,
          captureSources: [row.source],
          tags: row.tags,
          currentStage: row.stage && row.stage !== 'CUSTOMER' ? row.stage : 'NEW',
        });
        await logLeadEvent('LEAD_IMPORTED', { source: row.source, by: 'team' }, actorId, { leadId: created._id, phone: row.phone });
        if (row.stage === 'CUSTOMER') await applyStage(created, 'CUSTOMER', actorId);
        if (row.notes) await logLeadEvent('NOTE_ADDED', { text: row.notes.slice(0, 2000), via: 'import' }, actorId, { leadId: created._id, phone: row.phone });
        summary.created++;
        continue;
      }
      const set: Record<string, unknown> = {};
      const { usablePersonName } = await import('@/lib/personName');
      if (!usablePersonName(lead.name, lead.businessType) && row.name) set.name = row.name;
      for (const f of ['email', 'businessType', 'city'] as const) if (!lead[f] && row[f]) set[f] = row[f];
      const tags = [...new Set([...(lead.tags || []), ...row.tags])].slice(0, 20);
      if (tags.length !== (lead.tags || []).length) set.tags = tags;
      const changeStage = !!(opts.updateStages && row.stage && row.stage !== lead.currentStage);
      if (!Object.keys(set).length && !changeStage && !row.notes) { summary.skipped++; continue; }
      if (Object.keys(set).length) {
        await Lead.updateOne({ _id: lead._id }, { $set: set });
        await logLeadEvent('LEAD_UPDATED', { fields: Object.keys(set), by: 'team', via: 'import' }, actorId, { leadId: lead._id, phone: lead.phone });
      }
      if (changeStage) await applyStage(lead, row.stage!, actorId, 'csv import');
      if (row.notes) await logLeadEvent('NOTE_ADDED', { text: row.notes.slice(0, 2000), via: 'import' }, actorId, { leadId: lead._id, phone: lead.phone });
      summary.updated++;
    } catch (err: any) {
      summary.errors.push({ row: line, error: err?.message || 'could not be saved' });
    }
  }
  return summary;
}
