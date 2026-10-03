import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { canonicalSource, ORGANIC_SOURCES, type CustomerLeadSource } from './sources';

/**
 * CUSTOMER CRM — the single logic layer for leads that belong to a customer
 * business (Lead.businessId = the workspace). Every customer-CRM creation path
 * (web Add Lead, app Add Lead, CSV import, contacts import, campaign upload,
 * appointments, WhatsApp inbound, saved phone calls) goes through
 * createOrUpdateCustomerLead(); every stage move goes through
 * changeCustomerLeadStage().
 *
 * NOT used by the super-admin CRM: GrowwMatics' own prospects
 * (tenantId 'gmbboost-internal') are refused here by construction.
 *
 * Never sends anything to the lead. Follow-ups are owner tasks (FollowUp
 * kind 'task'), not messages.
 */

export const PLATFORM_TENANT = 'gmbboost-internal';

export interface LeadActivityInput {
  type: 'call' | 'WhatsApp' | 'email' | 'note' | 'meeting' | 'status_change' | 'lead_created' | 'follow_up' | 'appointment' | 'deal_won' | 'deal_lost';
  content: string;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export interface CustomerLeadInput {
  businessId: string;
  organizationId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source: unknown;
  notes?: string | null;
  interest?: string | null;
  valuation?: number | null;
  tags?: string[];
  /** Initial stage; anything other than 'initial' must be a lifecycle group. */
  lifeCycleStage?: 'initial' | 'active' | 'converted' | 'closed';
  createdBy?: string | null;
  /** Extra timeline entry for this event (e.g. "Incoming call"). */
  activity?: LeadActivityInput | null;
  /** Skip the owner new-lead alert event (used by tests). Default: queued. */
  skipAutomation?: boolean;
  /** Bulk paths (CSV, contacts, campaign upload): never alert the owner per row,
   *  even when a row's source column says e.g. WhatsApp. */
  bulk?: boolean;
}

export interface CustomerLeadResult {
  lead: any;
  created: boolean;
  /** Why an input row was not saved (no name/phone/email). */
  skippedReason?: string;
}

async function models() {
  const [{ default: Lead }, { default: Activity }] = await Promise.all([import('@/models/Lead'), import('@/models/Activity')]);
  return { Lead, Activity };
}

/** Timeline entry on a customer lead. */
export async function logLeadActivity(lead: { _id: any; tenantId: string; organizationId?: string }, a: LeadActivityInput): Promise<any> {
  const { Activity } = await models();
  return Activity.create({
    tenantId: lead.tenantId,
    organizationId: lead.organizationId,
    leadId: lead._id,
    type: a.type,
    content: a.content,
    ...(a.metadata ? { metadata: a.metadata } : {}),
    ...(a.createdBy && mongoose.isValidObjectId(a.createdBy) ? { createdBy: a.createdBy } : {}),
  });
}

/**
 * In-memory match index for bulk paths (CSV / contacts / campaign import):
 * ONE query for the workspace's phones + emails instead of one full scan per
 * row. createOrUpdateCustomerLead keeps it current as rows are created, so
 * duplicates inside the same file are caught too.
 */
export interface CustomerLeadIndex {
  byPhone: Map<string, string>;
  byEmail: Map<string, string>;
}

export async function buildCustomerLeadIndex(businessId: string): Promise<CustomerLeadIndex> {
  await dbConnect();
  const { Lead } = await models();
  const rows: any[] = await Lead.find({
    businessId: new mongoose.Types.ObjectId(businessId),
    $or: [{ phone: { $nin: [null, ''] } }, { email: { $nin: [null, ''] } }],
  }).select('phone email').lean();
  const index: CustomerLeadIndex = { byPhone: new Map(), byEmail: new Map() };
  for (const r of rows) addToIndex(index, r);
  return index;
}

function addToIndex(index: CustomerLeadIndex, lead: { _id: any; phone?: string | null; email?: string | null }) {
  const key = lead.phone ? phoneDedupeKey(lead.phone) : null;
  if (key && !index.byPhone.has(key)) index.byPhone.set(key, String(lead._id));
  const email = lead.email ? String(lead.email).trim().toLowerCase() : '';
  if (email && !index.byEmail.has(email)) index.byEmail.set(email, String(lead._id));
}

/** Existing lead of THIS business with the same phone (format-insensitive) or email. */
export async function findCustomerLeadMatch(
  businessId: string,
  phone: string | null,
  email: string | null,
  index?: CustomerLeadIndex | null,
): Promise<any | null> {
  const { Lead } = await models();
  const bid = new mongoose.Types.ObjectId(businessId);
  const key = phone ? phoneDedupeKey(phone) : null;
  if (index) {
    const id = (key && index.byPhone.get(key)) || (email && index.byEmail.get(email.toLowerCase())) || null;
    return id ? Lead.findOne({ _id: id, businessId: bid }) : null;
  }
  if (phone) {
    // Fast path (indexed): leads saved by this service store the normalized number.
    const exact = await Lead.findOne({ businessId: bid, phone });
    if (exact) return exact;
  }
  if (key) {
    // Legacy rows use inconsistent formats — compare dedupe keys, per workspace.
    const candidates: any[] = await Lead.find({ businessId: bid, phone: { $nin: [null, ''] } }).select('phone').lean();
    const hit = candidates.find((c) => phoneDedupeKey(c.phone) === key);
    if (hit) return Lead.findById(hit._id);
  }
  if (email) {
    const hit = await Lead.findOne({ businessId: bid, email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
    if (hit) return hit;
  }
  return null;
}

export async function createOrUpdateCustomerLead(
  input: CustomerLeadInput,
  opts: { index?: CustomerLeadIndex | null } = {},
): Promise<CustomerLeadResult> {
  await dbConnect();
  if (!input.businessId || !mongoose.isValidObjectId(input.businessId)) throw new Error('Customer CRM lead needs a businessId');
  if (!input.organizationId || input.organizationId === PLATFORM_TENANT) throw new Error('Customer CRM cannot create platform (super-admin) leads');
  const { Lead } = await models();

  const phone = input.phone ? normalizePhoneE164(String(input.phone)) || null : null;
  const email = input.email && /\S+@\S+\.\S+/.test(String(input.email)) ? String(input.email).trim().toLowerCase() : null;
  const name = (input.name && String(input.name).trim()) || phone || email || '';
  if (!name) return { lead: null, created: false, skippedReason: 'A name, phone number or email is required.' };
  const source: CustomerLeadSource = canonicalSource(input.source);

  const existing = await findCustomerLeadMatch(input.businessId, phone, email, opts.index);
  if (existing) {
    // Fill gaps only — never overwrite what the owner already has.
    if ((!existing.name || existing.name === existing.phone) && input.name && String(input.name).trim() && String(input.name).trim() !== phone) existing.name = String(input.name).trim();
    if (!existing.email && email) existing.email = email;
    if (!existing.phone && phone) existing.phone = phone;
    if (!existing.interest && input.interest) existing.interest = input.interest;
    existing.lastActivityAt = new Date();
    await existing.save();
    if (input.activity) await logLeadActivity(existing, input.activity);
    return { lead: existing, created: false };
  }

  const lead = await Lead.create({
    tenantId: input.organizationId,
    organizationId: input.organizationId,
    businessId: new mongoose.Types.ObjectId(input.businessId),
    leadType: 'Client Prospect',
    name,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    source,
    ...(input.notes ? { notes: String(input.notes).slice(0, 4000) } : {}),
    ...(input.interest ? { interest: String(input.interest).slice(0, 500) } : {}),
    ...(typeof input.valuation === 'number' && input.valuation >= 0 ? { valuation: input.valuation } : {}),
    ...(input.tags?.length ? { tags: input.tags.slice(0, 20) } : {}),
    lifeCycleStage: input.lifeCycleStage && ['initial', 'active', 'closed'].includes(input.lifeCycleStage) ? input.lifeCycleStage : 'initial',
    subStage: null,
    subStageId: null,
    pipelineStage: null,
    status: 'active',
    lastActivityAt: new Date(),
  });
  await logLeadActivity(lead, { type: 'lead_created', content: `Lead created — source: ${source}`, metadata: { source }, createdBy: input.createdBy });
  if (input.activity) await logLeadActivity(lead, input.activity);
  if (opts.index) addToIndex(opts.index, lead);

  if (!input.skipAutomation) {
    const { inngest } = await import('@/services/inngest/client');
    await inngest.send({
      name: 'crm/lead-created',
      data: { leadId: String(lead._id), businessId: input.businessId, notifyOwner: !input.bulk && ORGANIC_SOURCES.has(source) },
    }).catch((e: any) => console.error('[customerLeads] lead-created dispatch failed:', e?.message));
  }
  return { lead, created: true };
}

// ── Stage moves ──────────────────────────────────────────────────────────

export interface DealInput { value: number; currency?: string; closedAt?: string | Date | null; notes?: string | null }

export type StageChangeResult =
  | { ok: true; lead: any; changed: boolean }
  | { ok: false; status: number; code: 'NOT_FOUND' | 'INVALID_STAGE' | 'DEAL_VALUE_REQUIRED' | 'INVALID_DEAL'; error: string };

/**
 * Moves a customer lead to a stage. The canonical state is lifeCycleStage
 * (+ subStageId / subStage from the business's stage config).
 *  - Moving INTO converted needs a deal value (numeric amount + currency)
 *    unless the lead already has one, or the request is from a legacy client
 *    that cannot ask for it (legacy: true → recorded as valueMissing).
 *  - converted ⇒ convertedAt + deal_won activity; closed ⇒ lostAt + deal_lost.
 *  - Every move writes a status_change activity.
 */
export async function changeCustomerLeadStage(opts: {
  businessId: string;
  leadId: string;
  userId?: string | null;
  lifeCycleStage?: string | null;
  subStageId?: string | null;
  subStage?: string | null;
  /** LEGACY app builds: a Kanban column name only. */
  legacyColumn?: string | null;
  deal?: DealInput | null;
  legacy?: boolean;
}): Promise<StageChangeResult> {
  await dbConnect();
  const { Lead } = await models();
  const [{ default: Business }, stages, { inferLifeCycleStage }] = await Promise.all([
    import('@/models/Business'), import('@/lib/leadStages'), import('@/lib/crm/lifecycleStage'),
  ]);
  if (!mongoose.isValidObjectId(opts.leadId)) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Lead not found' };
  const lead: any = await Lead.findOne({ _id: opts.leadId, businessId: opts.businessId });
  if (!lead) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Lead not found' };
  const biz: any = await Business.findById(opts.businessId).select('leadStages').lean();
  const config = stages.resolveLeadStagesConfig(biz?.leadStages);

  let target: { lifeCycleStage: string; subStageId: string | null; subStage: string | null } | null;
  if (opts.lifeCycleStage) {
    target = stages.resolveStage(config, { lifeCycleStage: opts.lifeCycleStage, subStageId: opts.subStageId, subStage: opts.subStage });
  } else if (opts.subStageId || opts.subStage) {
    target = stages.resolveStage(config, { lifeCycleStage: lead.lifeCycleStage || 'initial', subStageId: opts.subStageId, subStage: opts.subStage });
  } else if (opts.legacyColumn !== undefined) {
    target = stages.legacyColumnToStage(config, opts.legacyColumn)
      ?? { lifeCycleStage: inferLifeCycleStage(opts.legacyColumn), subStageId: null, subStage: null };
  } else {
    return { ok: true, lead, changed: false };
  }
  if (!target) return { ok: false, status: 400, code: 'INVALID_STAGE', error: 'That stage does not exist for this business.' };

  const before = { lc: lead.lifeCycleStage || 'initial', sub: lead.subStage || null };
  const enteringConverted = target.lifeCycleStage === 'converted' && before.lc !== 'converted';
  const hasValue = typeof lead.deal?.value === 'number';
  let deal: any = null;
  if (opts.deal) {
    const v = Number(opts.deal.value);
    if (!Number.isFinite(v) || v < 0) return { ok: false, status: 400, code: 'INVALID_DEAL', error: 'Deal value must be a number of 0 or more.' };
    const currency = String(opts.deal.currency || 'INR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, status: 400, code: 'INVALID_DEAL', error: 'Currency must be a 3-letter code, e.g. INR.' };
    const closedAt = opts.deal.closedAt ? new Date(opts.deal.closedAt) : new Date();
    if (Number.isNaN(closedAt.getTime())) return { ok: false, status: 400, code: 'INVALID_DEAL', error: 'Invalid closed date.' };
    deal = { value: Math.round(v * 100) / 100, currency, closedAt, notes: opts.deal.notes ? String(opts.deal.notes).slice(0, 1000) : undefined, ...(opts.userId && mongoose.isValidObjectId(opts.userId) ? { recordedBy: opts.userId } : {}), valueMissing: false };
  }
  // A deal value belongs to a Won lead only — never stored on Open/Active/Lost.
  if (deal && target.lifeCycleStage !== 'converted') {
    return { ok: false, status: 400, code: 'INVALID_DEAL', error: 'A deal value can only be recorded when the lead is marked Won.' };
  }
  if (enteringConverted && !deal && !hasValue && !opts.legacy) {
    return { ok: false, status: 422, code: 'DEAL_VALUE_REQUIRED', error: 'What was the deal value? Enter it to mark this lead as won.' };
  }

  lead.lifeCycleStage = target.lifeCycleStage;
  lead.subStage = target.subStage;
  lead.subStageId = target.subStageId;
  if (opts.legacyColumn !== undefined) lead.pipelineStage = opts.legacyColumn;
  if (deal) lead.deal = deal;
  else if (enteringConverted && !hasValue) lead.deal = { value: null, currency: 'INR', closedAt: new Date(), valueMissing: true };
  if (enteringConverted) lead.convertedAt = new Date();
  if (target.lifeCycleStage === 'closed' && before.lc !== 'closed') lead.lostAt = new Date();
  if (target.lifeCycleStage !== 'converted' && before.lc === 'converted') lead.convertedAt = null;
  lead.lastActivityAt = new Date();
  await lead.save();

  const changed = before.lc !== lead.lifeCycleStage || before.sub !== (lead.subStage || null);
  const label = (lc: string, sub: string | null) => `${lc === 'initial' ? config.initialLabel : lc[0].toUpperCase() + lc.slice(1)}${sub ? ` · ${sub}` : ''}`;
  if (changed) {
    await logLeadActivity(lead, { type: 'status_change', content: `Moved from ${label(before.lc, before.sub)} to ${label(lead.lifeCycleStage, lead.subStage)}`, createdBy: opts.userId });
  }
  if (enteringConverted) {
    await logLeadActivity(lead, {
      type: 'deal_won',
      content: lead.deal?.value != null ? `Deal won — ${lead.deal.currency} ${lead.deal.value.toLocaleString('en-IN')}` : 'Deal won — value not recorded',
      metadata: { value: lead.deal?.value ?? null, currency: lead.deal?.currency ?? null },
      createdBy: opts.userId,
    });
  } else if (deal && before.lc === 'converted') {
    await logLeadActivity(lead, { type: 'deal_won', content: `Deal value recorded — ${deal.currency} ${deal.value.toLocaleString('en-IN')}`, metadata: { value: deal.value, currency: deal.currency }, createdBy: opts.userId });
  }
  if (lead.lifeCycleStage === 'closed' && before.lc !== 'closed') {
    await logLeadActivity(lead, { type: 'deal_lost', content: `Closed${lead.subStage ? ` — ${lead.subStage}` : ''}`, createdBy: opts.userId });
  }
  return { ok: true, lead, changed };
}
