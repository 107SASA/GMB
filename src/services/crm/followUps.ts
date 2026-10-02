import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { logLeadActivity } from './customerLeads';
import { STALE_LEAD_DAYS } from './constants';

/**
 * Customer CRM follow-ups = TASKS / REMINDERS for the owner or a team member
 * ("Call Rahul tomorrow 11:00 — discuss quotation"). They never message the
 * lead. The owner gets an in-app + push reminder when one is due and then
 * calls / WhatsApps / emails the lead themselves.
 */

export const FOLLOW_UP_TYPES = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Other'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

async function deps() {
  const [{ default: FollowUp }, { default: Lead }] = await Promise.all([import('@/models/FollowUp'), import('@/models/Lead')]);
  return { FollowUp, Lead };
}

export async function createFollowUpTask(opts: {
  businessId: string;
  organizationId: string;
  leadId: string;
  dueAt: Date;
  type?: string;
  note?: string | null;
  assignedUserId?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: true; followUp: any } | { ok: false; status: number; error: string }> {
  await dbConnect();
  const { FollowUp, Lead } = await deps();
  if (!mongoose.isValidObjectId(opts.leadId)) return { ok: false, status: 404, error: 'Lead not found' };
  const lead: any = await Lead.findOne({ _id: opts.leadId, businessId: opts.businessId });
  if (!lead) return { ok: false, status: 404, error: 'Lead not found' };
  if (!(opts.dueAt instanceof Date) || Number.isNaN(opts.dueAt.getTime())) return { ok: false, status: 400, error: 'A valid date and time are required.' };
  const type: FollowUpType = (FOLLOW_UP_TYPES as readonly string[]).includes(String(opts.type)) ? (opts.type as FollowUpType) : 'Call';
  if (opts.assignedUserId) {
    // The assignee must be a member of THIS workspace (or its organization).
    const { default: User } = await import('@/models/User');
    const member = mongoose.isValidObjectId(opts.assignedUserId) && await User.exists({
      _id: opts.assignedUserId,
      isDeleted: { $ne: true },
      $or: [{ businessIds: lead.businessId }, { organizationId: opts.organizationId }],
    });
    if (!member) return { ok: false, status: 400, error: 'That team member is not part of this workspace.' };
  }
  const followUp = await FollowUp.create({
    tenantId: opts.organizationId,
    organizationId: opts.organizationId,
    businessId: lead.businessId,
    leadId: lead._id,
    kind: 'task',
    type,
    note: opts.note ? String(opts.note).slice(0, 1000) : undefined,
    scheduledFor: opts.dueAt,
    status: 'pending',
    ...(opts.assignedUserId && mongoose.isValidObjectId(opts.assignedUserId) ? { assignedUserId: opts.assignedUserId } : {}),
    ...(opts.createdBy && mongoose.isValidObjectId(opts.createdBy) ? { createdBy: opts.createdBy } : {}),
  });
  await logLeadActivity(lead, {
    type: 'follow_up',
    content: `Follow-up scheduled — ${type} on ${opts.dueAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}${opts.note ? `: ${String(opts.note).slice(0, 200)}` : ''}`,
    metadata: { followUpId: String(followUp._id), type },
    createdBy: opts.createdBy,
  });
  return { ok: true, followUp };
}

export async function updateFollowUpTask(opts: {
  businessId: string;
  followUpId: string;
  userId?: string | null;
  action: 'complete' | 'cancel' | 'reschedule';
  dueAt?: Date;
  note?: string | null;
}): Promise<{ ok: true; followUp: any } | { ok: false; status: number; error: string }> {
  await dbConnect();
  const { FollowUp, Lead } = await deps();
  if (!mongoose.isValidObjectId(opts.followUpId)) return { ok: false, status: 404, error: 'Follow-up not found' };
  // Workspace-scoped: a follow-up of another business is "not found".
  const f: any = await FollowUp.findOne({ _id: opts.followUpId, businessId: opts.businessId, kind: 'task' });
  if (!f) return { ok: false, status: 404, error: 'Follow-up not found' };
  const lead: any = await Lead.findOne({ _id: f.leadId, businessId: opts.businessId });
  if (opts.action === 'complete') {
    if (f.status !== 'completed') {
      f.status = 'completed';
      f.completedAt = new Date();
      if (lead) {
        lead.lastContactedAt = new Date();
        lead.lastActivityAt = new Date();
        await lead.save();
        await logLeadActivity(lead, { type: 'follow_up', content: `Follow-up completed — ${f.type || 'Task'}${opts.note ? `: ${String(opts.note).slice(0, 200)}` : ''}`, metadata: { followUpId: String(f._id) }, createdBy: opts.userId });
      }
    }
  } else if (opts.action === 'cancel') {
    f.status = 'cancelled';
  } else {
    if (!opts.dueAt || Number.isNaN(opts.dueAt.getTime())) return { ok: false, status: 400, error: 'A valid date and time are required.' };
    f.scheduledFor = opts.dueAt;
    f.status = 'pending';
    f.reminderSentAt = undefined;
  }
  if (opts.note !== undefined && opts.note !== null && opts.action !== 'complete') f.note = String(opts.note).slice(0, 1000);
  await f.save();
  return { ok: true, followUp: f };
}

/**
 * Due-task reminders: in-app + push to the business's users, once per task.
 * Never contacts the lead.
 */
export async function sendDueFollowUpReminders(now = new Date()): Promise<{ reminded: number }> {
  await dbConnect();
  const { FollowUp, Lead } = await deps();
  const due: any[] = await FollowUp.find({
    kind: 'task', status: 'pending', businessId: { $exists: true },
    scheduledFor: { $lte: new Date(now.getTime() + 5 * 60_000) },
    reminderSentAt: { $exists: false },
  }).limit(500).lean();
  let reminded = 0;
  for (const f of due) {
    // Atomic claim — a parallel run never reminds twice.
    const claimed = await FollowUp.findOneAndUpdate({ _id: f._id, reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: now } });
    if (!claimed) continue;
    const lead: any = await Lead.findOne({ _id: f.leadId, businessId: f.businessId }).select('name phone').lean();
    if (!lead) continue;
    const title = `Follow up with ${lead.name || lead.phone || 'a lead'}`;
    const body = `${f.type || 'Task'}${f.note ? ` — ${f.note}` : ''}`.slice(0, 200);
    try {
      const { notifyBusinessUsers } = await import('@/services/notifications');
      await notifyBusinessUsers(String(f.businessId), { type: 'crm_follow_up_due', title, body, link: '/dashboard/crm' });
    } catch { /* best-effort */ }
    try {
      const { sendPushToBusinessUsers } = await import('@/services/push');
      await sendPushToBusinessUsers(String(f.businessId), { title, body, data: { crmLeadId: String(f.leadId), followUpId: String(f._id) } });
    } catch { /* best-effort */ }
    reminded++;
  }
  return { reminded };
}

export { STALE_LEAD_DAYS };
const DAY_MS = 86_400_000;

/**
 * "You haven't followed up with Rahul Sharma for 5 days" — deterministic, from
 * CRM data only (no AI): open/active leads whose last contact (or creation)
 * is STALE_LEAD_DAYS+ days ago, with no pending follow-up task and no booked
 * appointment. Each lead is reminded once per silent period (followUpNudgedAt;
 * contacting the lead starts a new period). One in-app + push notification
 * per business per run. Never contacts the lead.
 */
export async function sendStaleLeadReminders(now = new Date()): Promise<{ businesses: number; leads: number }> {
  await dbConnect();
  const { FollowUp, Lead } = await deps();
  const [{ default: Appointment }, { default: Business }] = await Promise.all([import('@/models/Appointment'), import('@/models/Business')]);
  const cutoff = new Date(now.getTime() - STALE_LEAD_DAYS * DAY_MS);
  const candidates: any[] = await Lead.find({
    businessId: { $ne: null },
    tenantId: { $ne: 'gmbboost-internal' },
    status: 'active',
    lifeCycleStage: { $in: ['initial', 'active'] },
    $and: [
      { $or: [{ lastContactedAt: { $lte: cutoff } }, { lastContactedAt: null, createdAt: { $lte: cutoff } }] },
      // Not yet reminded in THIS silent period: never reminded, or reminded
      // before the last contact. Done in the query (not after the limit) so
      // leads that stay silent forever can't crowd new overdue leads out.
      { $or: [{ followUpNudgedAt: null }, { $expr: { $lt: ['$followUpNudgedAt', { $ifNull: ['$lastContactedAt', '$createdAt'] }] } }] },
    ],
  }).select('name phone businessId lastContactedAt createdAt followUpNudgedAt').sort({ lastContactedAt: 1, createdAt: 1 }).limit(2000).lean();

  const ids = candidates.map((l) => l._id);
  const [withTask, withMeeting, deletedBiz] = await Promise.all([
    FollowUp.distinct('leadId', { kind: 'task', status: 'pending', leadId: { $in: ids } }),
    Appointment.distinct('leadId', { status: { $in: ['Scheduled', 'Pending Confirmation'] }, leadId: { $in: ids } }),
    Business.distinct('_id', { _id: { $in: [...new Set(candidates.map((l) => String(l.businessId)))] }, isDeleted: true }),
  ]);
  const skip = new Set([...withTask, ...withMeeting].map(String));
  const deleted = new Set(deletedBiz.map(String));

  const byBusiness = new Map<string, Array<{ lead: any; days: number }>>();
  for (const lead of candidates) {
    if (skip.has(String(lead._id)) || deleted.has(String(lead.businessId))) continue;
    const lastTouch = new Date(lead.lastContactedAt || lead.createdAt);
    if (lead.followUpNudgedAt && new Date(lead.followUpNudgedAt) >= lastTouch) continue;
    // Atomic claim — a parallel run never reminds twice. No timestamps: a reminder is not lead activity.
    const claimed = await Lead.updateOne(
      { _id: lead._id, followUpNudgedAt: lead.followUpNudgedAt ?? null },
      { $set: { followUpNudgedAt: now } },
      { timestamps: false },
    );
    if (!claimed.modifiedCount) continue;
    const list = byBusiness.get(String(lead.businessId)) ?? [];
    list.push({ lead, days: Math.floor((now.getTime() - lastTouch.getTime()) / DAY_MS) });
    byBusiness.set(String(lead.businessId), list);
  }

  let leads = 0;
  for (const [businessId, list] of byBusiness) {
    list.sort((a, b) => b.days - a.days);
    const first = list[0];
    const who = first.lead.name || first.lead.phone || 'a lead';
    const single = list.length === 1;
    const title = single ? 'Follow-up overdue' : 'Follow-ups overdue';
    const body = single
      ? `You haven't followed up with ${who} for ${first.days} days. Tap to open lead.`
      : `You haven't followed up with ${who} and ${list.length - 1} other lead${list.length - 1 === 1 ? '' : 's'} for ${STALE_LEAD_DAYS}+ days. Tap to open your CRM.`;
    try {
      const { notifyBusinessUsers } = await import('@/services/notifications');
      await notifyBusinessUsers(businessId, { type: 'crm_follow_up_overdue', title, body, link: '/dashboard/crm' });
    } catch { /* best-effort */ }
    try {
      const { sendPushToBusinessUsers } = await import('@/services/push');
      await sendPushToBusinessUsers(businessId, { title, body, data: single ? { crmLeadId: String(first.lead._id) } : { crmLeads: '1' } });
    } catch { /* best-effort */ }
    leads += list.length;
  }
  return { businesses: byBusiness.size, leads };
}
