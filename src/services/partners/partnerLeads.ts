import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import FollowUp from '@/models/FollowUp';
import { logLeadEvent } from '@/services/leadEvents';
import { normalizePhoneE164 } from '@/lib/phone';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';
import {
  CRM_STAGES,
  FOLLOW_UP_TYPES,
  crmDisplayName,
  normaliseCrmImportRow,
} from '@/lib/admin/platformCrm';
import {
  partnerCanSeeEvent,
  partnerEventView,
  partnerFollowUpTenant,
  partnerStageCheck,
} from '@/lib/partners/partnerCrmRules';
import { phoneVariants } from '@/services/billing/customerActivation';

/**
 * Growth Partner CRM — the partner's own leads in the platform pipeline.
 *
 * Every lead here is a platform Lead (tenant 'gmbboost-internal') stamped
 * with the partner's id, so it shows in the super admin CRM too and converts
 * through the normal payment flow. Every query is scoped by the SESSION
 * partner's id — a partner can never read or change another lead.
 *
 * No automated messaging, ever: a partner lead is created HUMAN-owned with
 * nurture STOPPED. Every AI agent, drip, follow-up cron and WhatsApp
 * campaign already stands down for exactly that (isHumanOwned /
 * isOptedOutOrDoNotContact / campaign eligibility), and setLeadOwnership
 * refuses to hand a partner lead to an AI agent later.
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const scope = (partnerId: string) => ({ tenantId: PLATFORM_TENANT, partnerId: new mongoose.Types.ObjectId(partnerId) });

async function ownLead(partnerId: string, leadId: string): Promise<any | null> {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return null;
  return Lead.findOne({ _id: leadId, ...scope(partnerId) });
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

/** Already somewhere in the platform pipeline (any owner)? Matches every stored spelling of the number. */
async function phoneTaken(phone: string, exceptLeadId?: unknown): Promise<boolean> {
  return !!(await Lead.exists({
    tenantId: PLATFORM_TENANT,
    phone: { $in: phoneVariants(phone) },
    ...(exceptLeadId ? { _id: { $ne: exceptLeadId } } : {}),
  }));
}

/** Fields a partner lead is always created with — the reason no AI ever messages it. */
const PARTNER_LEAD_DEFAULTS = {
  tenantId: PLATFORM_TENANT,
  leadType: 'Platform Prospect',
  source: 'Referral',
  captureSources: ['Referral'],
  currentAgent: 'HUMAN',
  nurtureStatus: 'STOPPED',
  partnerSource: 'added',
} as const;

export const TAKEN_MESSAGE =
  'This business is already in our system, so it can’t be added as your lead. Contact us if you think this is a mistake.';

export function partnerLeadRow(l: any) {
  return {
    _id: String(l._id),
    name: crmDisplayName(l),
    contactName: l.name ?? null,
    business: l.businessType ?? null,
    phone: l.phone ?? null,
    email: l.email ?? null,
    city: l.city ?? null,
    currentStage: l.currentStage || 'NEW',
    stageLabel: CRM_STAGES.find((s) => s.value === (l.currentStage || 'NEW'))?.label ?? 'New',
    dealValue: l.valuation ?? l.deal?.value ?? null,
    tags: l.tags ?? [],
    createdAt: l.createdAt,
    lastActivityAt: l.lastActivityAt ?? l.updatedAt ?? null,
    /** Came in through the partner's referral link — our team runs it; the partner can add notes and follow-ups. */
    viaReferral: l.partnerSource === 'referral',
  };
}

const ROW_FIELDS = 'name businessType phone email city currentStage valuation deal tags createdAt updatedAt lastActivityAt partnerSource';

export async function listPartnerLeads(partnerId: string, opts: { q?: string; stage?: string; customers?: boolean } = {}) {
  await dbConnect();
  const filter: Record<string, unknown> = scope(partnerId);
  if (opts.customers) filter.currentStage = 'CUSTOMER';
  else if (opts.stage && CRM_STAGES.some((s) => s.value === opts.stage)) filter.currentStage = opts.stage;
  const q = text(opts.q, 80);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { businessType: rx }, { phone: rx }, { email: rx }, { city: rx }];
  }
  const leads = await Lead.find(filter).select(ROW_FIELDS).sort({ createdAt: -1 }).limit(1000).lean();
  return leads.map(partnerLeadRow);
}

export async function createPartnerLead(partner: { _id: unknown }, userId: string, input: Record<string, unknown>) {
  const phone = normalizePhoneE164(text(input.phone, 30));
  if (!phone) return fail(400, 'Enter a valid mobile number.');
  const name = text(input.name, 120);
  const business = text(input.business, 160);
  if (!name && !business) return fail(400, 'Enter a contact name or a business name.');
  const email = text(input.email, 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return fail(400, 'That email is not valid.');
  const stageCheck = input.stage ? partnerStageCheck('NEW', input.stage) : ({ ok: true, stage: 'NEW' } as const);
  if (!stageCheck.ok) return fail(400, stageCheck.error);

  await dbConnect();
  if (await phoneTaken(phone)) return fail(409, TAKEN_MESSAGE);

  const lead = await Lead.create({
    ...PARTNER_LEAD_DEFAULTS,
    partnerId: partner._id,
    name: name || business,
    phone,
    email: email || undefined,
    businessType: business || undefined,
    city: text(input.city, 80) || undefined,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean).slice(0, 20) : [],
    currentStage: stageCheck.stage,
  });
  await logLeadEvent('LEAD_CREATED', { source: 'Referral', by: 'partner' }, userId, { leadId: lead._id, phone });
  const note = text(input.notes, 2000);
  if (note) await logLeadEvent('NOTE_ADDED', { text: note }, userId, { leadId: lead._id, phone });
  return { ok: true as const, lead: partnerLeadRow(lead.toObject()) };
}

export async function getPartnerLead(partnerId: string, userId: string, leadId: string) {
  await dbConnect();
  const lead = await ownLead(partnerId, leadId);
  if (!lead) return null;
  const [events, followUps] = await Promise.all([
    LeadEvent.find({ leadId: lead._id }).sort({ createdAt: -1 }).limit(300).select('type payload actor createdAt').lean(),
    FollowUp.find({ tenantId: partnerFollowUpTenant(partnerId), leadId: lead._id, kind: 'task' }).sort({ scheduledFor: -1 }).limit(100).lean(),
  ]);
  const now = Date.now();
  return {
    lead: { ...partnerLeadRow(lead.toObject()), lostReason: lead.lostReason ?? null },
    timeline: (events as any[]).filter((e) => partnerCanSeeEvent(e, userId)).map((e) => partnerEventView(e, userId)),
    followUps: (followUps as any[]).map((f) => ({
      _id: String(f._id),
      type: f.type || 'Call',
      note: f.note ?? null,
      dueAt: f.scheduledFor,
      status: f.status,
      overdue: f.status === 'pending' && new Date(f.scheduledFor).getTime() < now,
    })),
  };
}

export async function updatePartnerLead(partnerId: string, userId: string, leadId: string, patch: Record<string, unknown>) {
  await dbConnect();
  const lead = await ownLead(partnerId, leadId);
  if (!lead) return fail(404, 'Lead not found.');
  if (lead.partnerSource === 'referral') {
    return fail(409, 'This lead came in through your referral link, so our team is handling it. You can add notes and follow-ups.');
  }

  const set: Record<string, unknown> = {};
  const changed: string[] = [];

  const textFields: Array<[string, string, number]> = [
    ['name', 'name', 120],
    ['business', 'businessType', 160],
    ['city', 'city', 80],
    ['lostReason', 'lostReason', 500],
  ];
  for (const [key, field, max] of textFields) {
    if (!(key in patch)) continue;
    const value = text(patch[key], max);
    if (field === 'name' && !value) return fail(400, 'Name cannot be empty.');
    if (value !== String(lead[field] ?? '')) { set[field] = value || undefined; changed.push(key); }
  }
  if ('email' in patch) {
    const email = text(patch.email, 254).toLowerCase();
    if (email && !EMAIL_RE.test(email)) return fail(400, 'That email is not valid.');
    if (email !== String(lead.email ?? '')) { set.email = email || undefined; changed.push('email'); }
  }
  if ('phone' in patch) {
    const phone = normalizePhoneE164(text(patch.phone, 30));
    if (!phone) return fail(400, 'Enter a valid mobile number.');
    if (phone !== lead.phone) {
      if (await phoneTaken(phone, lead._id)) return fail(409, TAKEN_MESSAGE);
      set.phone = phone;
      changed.push('phone');
    }
  }
  if ('dealValue' in patch) {
    const raw = patch.dealValue;
    const value = raw === null || raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return fail(400, 'Deal value must be a positive number.');
    if (value !== (lead.valuation ?? null)) { set.valuation = value; changed.push('dealValue'); }
  }
  if ('tags' in patch) {
    if (!Array.isArray(patch.tags)) return fail(400, 'Tags must be a list.');
    const tags = (patch.tags as unknown[]).map((t) => text(t, 40)).filter(Boolean).slice(0, 20);
    if (JSON.stringify(tags) !== JSON.stringify(lead.tags || [])) { set.tags = tags; changed.push('tags'); }
  }

  let stage: string | null = null;
  if ('stage' in patch && patch.stage !== lead.currentStage) {
    const check = partnerStageCheck(lead.currentStage, patch.stage);
    if (!check.ok) return fail(400, check.error);
    stage = check.stage;
  }

  if (changed.length) {
    await Lead.updateOne({ _id: lead._id }, { $set: { ...set, lastActivityAt: new Date() } });
    await logLeadEvent('LEAD_UPDATED', { fields: changed, by: 'partner' }, userId, { leadId: lead._id, phone: (set.phone as string) || lead.phone });
  }
  if (stage) {
    const from = lead.currentStage || 'NEW';
    // Conditional on the stage we read, and never over a customer — a payment
    // landing at the same moment wins.
    const res = await Lead.updateOne(
      { _id: lead._id, currentStage: lead.currentStage ? lead.currentStage : { $in: [null] }, ...scope(partnerId) },
      { $set: { currentStage: stage, lastActivityAt: new Date(), ...(stage === 'LOST' ? { lostAt: new Date() } : {}) } }
    );
    if (res.modifiedCount === 0) return fail(409, 'This lead just changed. Refresh and try again.');
    await logLeadEvent('STAGE_CHANGED', { from, to: stage, by: 'partner' }, userId, { leadId: lead._id, phone: lead.phone });
  }
  return { ok: true as const };
}

export async function addPartnerNote(partnerId: string, userId: string, leadId: string, noteRaw: unknown) {
  const note = text(noteRaw, 2000);
  if (!note) return fail(400, 'Write a note first.');
  await dbConnect();
  const lead = await ownLead(partnerId, leadId);
  if (!lead) return fail(404, 'Lead not found.');
  await logLeadEvent('NOTE_ADDED', { text: note }, userId, { leadId: lead._id, phone: lead.phone });
  await Lead.updateOne({ _id: lead._id }, { $set: { lastActivityAt: new Date() } });
  return { ok: true as const };
}

// ── Follow-ups (reminders for the partner — never a message to the lead) ──

export async function createPartnerFollowUp(partnerId: string, userId: string, leadId: string, input: Record<string, unknown>) {
  const due = typeof input.dueAt === 'string' ? new Date(input.dueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return fail(400, 'Pick a date and time.');
  const type = (FOLLOW_UP_TYPES as readonly string[]).includes(String(input.type)) ? String(input.type) : 'Call';
  await dbConnect();
  const lead = await ownLead(partnerId, leadId);
  if (!lead) return fail(404, 'Lead not found.');
  const note = text(input.note, 1000) || undefined;
  const f = await FollowUp.create({
    tenantId: partnerFollowUpTenant(partnerId),
    leadId: lead._id,
    kind: 'task',
    type,
    note,
    scheduledFor: due,
    status: 'pending',
    assignedUserId: userId,
    createdBy: userId,
  });
  await logLeadEvent('FOLLOW_UP_SCHEDULED', { followUpId: String(f._id), type, dueAt: due.toISOString(), note: note?.slice(0, 200) }, userId, { leadId: lead._id, phone: lead.phone });
  return { ok: true as const, followUpId: String(f._id) };
}

export async function updatePartnerFollowUp(partnerId: string, userId: string, followUpId: string, input: Record<string, unknown>) {
  if (!mongoose.Types.ObjectId.isValid(followUpId)) return fail(404, 'Follow-up not found.');
  await dbConnect();
  const f: any = await FollowUp.findOne({ _id: followUpId, tenantId: partnerFollowUpTenant(partnerId), kind: 'task' });
  if (!f) return fail(404, 'Follow-up not found.');
  const status = input.status;
  if (status !== 'completed' && status !== 'cancelled' && status !== 'pending') return fail(400, 'Unknown status.');
  f.status = status;
  f.completedAt = status === 'completed' ? new Date() : undefined;
  await f.save();
  if (status === 'completed') {
    const lead: any = await Lead.findById(f.leadId).select('phone').lean();
    await logLeadEvent('FOLLOW_UP_DONE', { followUpId: String(f._id), type: f.type }, userId, { leadId: f.leadId, phone: lead?.phone });
    await Lead.updateOne({ _id: f.leadId }, { $set: { lastContactedAt: new Date(), lastActivityAt: new Date() } });
  }
  return { ok: true as const };
}

/** Open follow-ups across all of the partner's leads, due first. */
export async function listPartnerOpenFollowUps(partnerId: string) {
  await dbConnect();
  const rows: any[] = await FollowUp.find({ tenantId: partnerFollowUpTenant(partnerId), kind: 'task', status: 'pending' })
    .sort({ scheduledFor: 1 })
    .limit(100)
    .lean();
  const leads: any[] = await Lead.find({ _id: { $in: rows.map((r) => r.leadId) }, ...scope(partnerId) }).select('name businessType phone').lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const now = Date.now();
  return rows
    .filter((r) => byId.has(String(r.leadId)))
    .map((r) => ({
      _id: String(r._id),
      leadId: String(r.leadId),
      leadName: crmDisplayName(byId.get(String(r.leadId))),
      type: r.type || 'Call',
      note: r.note ?? null,
      dueAt: r.scheduledFor,
      overdue: new Date(r.scheduledFor).getTime() < now,
    }));
}

// ── Import ────────────────────────────────────────────────────────────────

export interface PartnerImportSummary {
  created: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

export async function importPartnerLeads(partner: { _id: unknown }, userId: string, rawRows: Record<string, unknown>[]): Promise<PartnerImportSummary> {
  await dbConnect();
  const summary: PartnerImportSummary = { created: 0, skipped: 0, errors: [] };
  const seen = new Set<string>();
  for (let i = 0; i < rawRows.length; i++) {
    const line = i + 2; // header is line 1
    const parsed = normaliseCrmImportRow(rawRows[i]);
    if (!parsed.ok) { summary.errors.push({ row: line, error: parsed.error }); continue; }
    const row = parsed.row;
    if (seen.has(row.phone)) { summary.skipped++; summary.errors.push({ row: line, error: 'same phone as an earlier row — skipped' }); continue; }
    seen.add(row.phone);
    try {
      if (await phoneTaken(row.phone)) { summary.skipped++; summary.errors.push({ row: line, error: 'already in our system — not added' }); continue; }
      const stage = row.stage ? partnerStageCheck('NEW', row.stage) : null;
      const created = await Lead.create({
        ...PARTNER_LEAD_DEFAULTS,
        partnerId: partner._id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        businessType: row.businessType,
        city: row.city,
        tags: row.tags,
        currentStage: stage && stage.ok ? stage.stage : 'NEW',
      });
      await logLeadEvent('LEAD_IMPORTED', { source: 'Referral', by: 'partner' }, userId, { leadId: created._id, phone: row.phone });
      if (row.notes) await logLeadEvent('NOTE_ADDED', { text: row.notes.slice(0, 2000), via: 'import' }, userId, { leadId: created._id, phone: row.phone });
      summary.created++;
    } catch (err: any) {
      summary.errors.push({ row: line, error: 'could not be saved' });
      console.error('[partnerLeads] import row failed:', err?.message);
    }
  }
  return summary;
}

// ── Overview numbers ──────────────────────────────────────────────────────

export async function partnerLeadStats(partnerId: string) {
  await dbConnect();
  const rows: any[] = await Lead.aggregate([
    { $match: scope(partnerId) },
    { $group: { _id: '$currentStage', n: { $sum: 1 } } },
  ]);
  const byStage: Record<string, number> = {};
  rows.forEach((r) => { byStage[r._id || 'NEW'] = r.n; });
  const groupOf = (stage: string) => CRM_STAGES.find((s) => s.value === stage)?.group ?? 'open';
  let total = 0;
  const byGroup: Record<string, number> = { open: 0, demo: 0, closing: 0, won: 0, inactive: 0, lost: 0 };
  for (const [stage, n] of Object.entries(byStage)) {
    total += n;
    byGroup[groupOf(stage)] = (byGroup[groupOf(stage)] ?? 0) + n;
  }
  const customers = byStage.CUSTOMER ?? 0;
  return { total, customers, byGroup, conversionRate: total ? Math.round((customers / total) * 1000) / 10 : 0 };
}

// ── Referred workspaces (signed up through the partner's link) ───────────

const WORKSPACE_STATUS: Record<string, string> = {
  active: 'Paying',
  trial_active: 'On trial',
  past_due: 'Payment due',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
};

/** Workspaces created through the partner's referral link — name, city, status only. */
export async function listReferredBusinesses(partnerId: string) {
  await dbConnect();
  const { default: Business } = await import('@/models/Business');
  const rows: any[] = await Business.find({ partnerId: new mongoose.Types.ObjectId(partnerId) })
    .select('name city subscriptionStatus createdAt')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  return rows.map((b) => ({
    _id: String(b._id),
    name: b.name || 'Business',
    city: b.city && b.city !== 'Unknown' ? b.city : null,
    status: WORKSPACE_STATUS[b.subscriptionStatus] ?? 'Signed up',
    paying: b.subscriptionStatus === 'active',
    createdAt: b.createdAt,
  }));
}
