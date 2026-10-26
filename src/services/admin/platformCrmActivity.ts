import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import User from '@/models/User';
import FollowUp from '@/models/FollowUp';
import PlatformCrmConfig from '@/models/PlatformCrmConfig';
import { logLeadEvent } from '@/services/leadEvents';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';
import {
  CALL_OUTCOMES,
  FOLLOW_UP_TYPES,
  callOutcomeLabel,
  crmDisplayName,
  validateSubStages,
  type CrmSubStage,
} from '@/lib/admin/platformCrm';

/**
 * Super admin CRM activity: call logs, follow-up reminders (tasks for the
 * team — never a message to the lead) and the team's custom sub-stages.
 * Follow-ups reuse the FollowUp model with tenantId 'gmbboost-internal' and
 * no businessId, so customer CRM queries (always scoped by businessId) never
 * see them.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; status: number; error: string };

async function platformLead(id: string): Promise<any | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Lead.findOne({ _id: id, tenantId: PLATFORM_TENANT }).select('_id name phone businessType assignedUserId currentStage');
}

async function teamMember(id: unknown): Promise<boolean> {
  return !!id && mongoose.Types.ObjectId.isValid(String(id)) && !!(await User.exists({ _id: id, role: 'SUPER_ADMIN' }));
}

// ── Calls ──────────────────────────────────────────────────────────────────

export async function logPlatformCall(
  leadId: string,
  input: { direction?: string; outcome?: string; durationMin?: unknown; notes?: string; at?: string },
  actorId: string
): Promise<Result> {
  await dbConnect();
  const lead = await platformLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  const direction = input.direction === 'inbound' ? 'inbound' : 'outbound';
  if (!CALL_OUTCOMES.some((o) => o.value === input.outcome)) return { ok: false, status: 400, error: 'Choose how the call went.' };
  const duration = input.durationMin === '' || input.durationMin == null ? null : Number(input.durationMin);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > 600)) return { ok: false, status: 400, error: 'Duration must be 0–600 minutes.' };
  const at = input.at ? new Date(input.at) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000) return { ok: false, status: 400, error: 'The call time is not valid.' };
  await logLeadEvent(
    'CALL_LOGGED',
    { direction, outcome: input.outcome, outcomeLabel: callOutcomeLabel(input.outcome), durationMin: duration, notes: String(input.notes || '').trim().slice(0, 2000) || undefined, at: at.toISOString() },
    actorId,
    { leadId: lead._id, phone: lead.phone }
  );
  await Lead.updateOne({ _id: lead._id }, { $set: { lastContactedAt: at } });
  return { ok: true };
}

// ── Follow-ups ─────────────────────────────────────────────────────────────

export async function createPlatformFollowUp(
  leadId: string,
  input: { dueAt?: string; type?: string; note?: string; assignedUserId?: string | null },
  actorId: string
): Promise<Result<{ followUpId: string }>> {
  await dbConnect();
  const lead = await platformLead(leadId);
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  const due = input.dueAt ? new Date(input.dueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return { ok: false, status: 400, error: 'Pick a date and time.' };
  const type = (FOLLOW_UP_TYPES as readonly string[]).includes(String(input.type)) ? input.type : 'Call';
  const assignee = input.assignedUserId || (lead.assignedUserId ? String(lead.assignedUserId) : actorId);
  if (!(await teamMember(assignee))) return { ok: false, status: 400, error: 'Assign it to a team member (super admin).' };
  const f = await FollowUp.create({
    tenantId: PLATFORM_TENANT,
    leadId: lead._id,
    kind: 'task',
    type,
    note: input.note ? String(input.note).slice(0, 1000) : undefined,
    scheduledFor: due,
    status: 'pending',
    assignedUserId: assignee,
    createdBy: mongoose.Types.ObjectId.isValid(actorId) ? actorId : undefined,
  });
  await logLeadEvent('FOLLOW_UP_SCHEDULED', { followUpId: String(f._id), type, dueAt: due.toISOString(), note: input.note ? String(input.note).slice(0, 200) : undefined }, actorId, { leadId: lead._id, phone: lead.phone });
  return { ok: true, followUpId: String(f._id) };
}

export async function updatePlatformFollowUp(
  id: string,
  input: { status?: string; dueAt?: string; note?: string },
  actorId: string
): Promise<Result> {
  await dbConnect();
  if (!mongoose.Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Follow-up not found.' };
  const f: any = await FollowUp.findOne({ _id: id, tenantId: PLATFORM_TENANT, kind: 'task', businessId: { $exists: false } });
  if (!f) return { ok: false, status: 404, error: 'Follow-up not found.' };
  if (input.status) {
    if (!['completed', 'cancelled', 'pending'].includes(input.status)) return { ok: false, status: 400, error: 'Unknown status.' };
    f.status = input.status;
    f.completedAt = input.status === 'completed' ? new Date() : undefined;
  }
  if (input.dueAt) {
    const due = new Date(input.dueAt);
    if (Number.isNaN(due.getTime())) return { ok: false, status: 400, error: 'Pick a date and time.' };
    f.scheduledFor = due;
    f.reminderSentAt = undefined; // a new time gets its own reminder
    if (f.status !== 'completed') f.status = 'pending';
  }
  if (input.note !== undefined) f.note = String(input.note).slice(0, 1000) || undefined;
  await f.save();
  if (input.status === 'completed') {
    const lead: any = await Lead.findById(f.leadId).select('phone').lean();
    await logLeadEvent('FOLLOW_UP_DONE', { followUpId: String(f._id), type: f.type }, actorId, { leadId: f.leadId, phone: lead?.phone });
    await Lead.updateOne({ _id: f.leadId }, { $set: { lastContactedAt: new Date() } });
  }
  return { ok: true };
}

/** Follow-ups for one lead, or the team's open ones (due first). */
export async function listPlatformFollowUps(opts: { leadId?: string; open?: boolean; assignedUserId?: string; dueBefore?: Date }) {
  await dbConnect();
  const filter: Record<string, unknown> = { tenantId: PLATFORM_TENANT, kind: 'task', businessId: { $exists: false } };
  if (opts.leadId) {
    if (!mongoose.Types.ObjectId.isValid(opts.leadId)) return [];
    filter.leadId = opts.leadId;
  }
  if (opts.open) filter.status = 'pending';
  if (opts.assignedUserId && mongoose.Types.ObjectId.isValid(opts.assignedUserId)) filter.assignedUserId = opts.assignedUserId;
  if (opts.dueBefore) filter.scheduledFor = { $lte: opts.dueBefore };
  const rows: any[] = await FollowUp.find(filter).sort(opts.open ? { scheduledFor: 1 } : { scheduledFor: -1 }).limit(200).lean();
  const leads: any[] = await Lead.find({ _id: { $in: rows.map((r) => r.leadId) } }).select('name businessType phone').lean();
  const users: any[] = await User.find({ _id: { $in: rows.map((r) => r.assignedUserId).filter(Boolean) } }).select('fullName email').lean();
  const leadById = new Map(leads.map((l) => [String(l._id), l]));
  const userById = new Map(users.map((u) => [String(u._id), u.fullName || u.email]));
  const now = Date.now();
  return rows.map((r) => {
    const l = leadById.get(String(r.leadId));
    return {
      _id: String(r._id),
      leadId: String(r.leadId),
      leadName: l ? crmDisplayName(l) : 'Lead',
      type: r.type || 'Call',
      note: r.note || null,
      dueAt: r.scheduledFor,
      status: r.status,
      overdue: r.status === 'pending' && new Date(r.scheduledFor).getTime() < now,
      assignedTo: r.assignedUserId ? userById.get(String(r.assignedUserId)) ?? null : null,
      assignedUserId: r.assignedUserId ? String(r.assignedUserId) : null,
    };
  });
}

/**
 * Pushes "Follow up with <lead>" to the assignee when a task falls due (and
 * to all super admins when nobody is assigned). Once per due time — claimed
 * atomically. Never contacts the lead.
 */
export async function sendDuePlatformFollowUpReminders(now = new Date()): Promise<{ reminded: number }> {
  await dbConnect();
  const due: any[] = await FollowUp.find({
    tenantId: PLATFORM_TENANT, kind: 'task', status: 'pending', businessId: { $exists: false },
    scheduledFor: { $lte: new Date(now.getTime() + 5 * 60_000) },
    reminderSentAt: { $exists: false },
  }).limit(500).lean();
  let reminded = 0;
  for (const f of due) {
    const claimed = await FollowUp.findOneAndUpdate({ _id: f._id, reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: now } });
    if (!claimed) continue;
    const lead: any = await Lead.findById(f.leadId).select('name businessType phone').lean();
    if (!lead) continue;
    const title = `Follow up with ${crmDisplayName(lead)}`;
    const body = `${f.type || 'Call'}${f.note ? ` — ${f.note}` : ''}`.slice(0, 200);
    const data = { leadId: String(f.leadId), followUpId: String(f._id), link: `/admin/leads/${f.leadId}` };
    try {
      const { sendPushToUser, sendPushToSuperAdmins } = await import('@/services/push');
      if (f.assignedUserId) await sendPushToUser(String(f.assignedUserId), { title, body, data });
      else await sendPushToSuperAdmins({ title, body, data });
    } catch { /* best-effort */ }
    reminded++;
  }
  return { reminded };
}

// ── Custom sub-stages ──────────────────────────────────────────────────────

export async function getPlatformSubStages(): Promise<CrmSubStage[]> {
  await dbConnect();
  const doc: any = await PlatformCrmConfig.findOne({ key: 'default' }).lean();
  return (doc?.subStages ?? []).map((s: any) => ({ id: s.id, name: s.name, stage: s.stage, color: s.color }));
}

/** Saves the list. A removed sub-stage is cleared from the leads that had it. */
export async function savePlatformSubStages(input: unknown, actorId: string): Promise<Result<{ subStages: CrmSubStage[] }>> {
  const v = validateSubStages(input);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  await dbConnect();
  const before = await getPlatformSubStages();
  await PlatformCrmConfig.updateOne({ key: 'default' }, { $set: { subStages: v.subStages, updatedBy: actorId } }, { upsert: true });
  const keep = new Map(v.subStages.map((s) => [s.id, s]));
  const removed = before.filter((s) => !keep.has(s.id)).map((s) => s.id);
  if (removed.length) {
    await Lead.updateMany({ tenantId: PLATFORM_TENANT, subStageId: { $in: removed } }, { $set: { subStageId: null, subStage: null } });
  }
  // A rename carries through to the leads that use it.
  for (const s of v.subStages) {
    const old = before.find((b) => b.id === s.id);
    if (old && old.name !== s.name) await Lead.updateMany({ tenantId: PLATFORM_TENANT, subStageId: s.id }, { $set: { subStage: s.name } });
  }
  return { ok: true, subStages: v.subStages };
}
