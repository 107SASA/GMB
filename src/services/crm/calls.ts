import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { normalizePhoneE164 } from '@/lib/phone';
import { nextOutcome, type NormalizedCallEvent } from '@/services/telephony/normalize';
import { createOrUpdateCustomerLead, findCustomerLeadMatch, logLeadActivity } from './customerLeads';

/**
 * Customer CRM call handling for integrated telephony (provider-agnostic —
 * receives services/telephony NormalizedCallEvent).
 *
 *  - Known caller (matched by normalized phone in THIS workspace): no new lead;
 *    a call activity + lastContactedAt on the existing lead.
 *  - Unknown caller: a pending CallEvent, and the owner is asked (push +
 *    in-app) "Save as lead / Existing lead / Dismiss" — no lead is created
 *    until they choose.
 *  - Never messages the caller.
 */

async function deps() {
  const [{ default: CallEvent }, { default: Business }] = await Promise.all([import('@/models/CallEvent'), import('@/models/Business')]);
  return { CallEvent, Business };
}

const fmtTime = (d: Date) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

async function askOwner(businessId: string, ev: any, kind: 'incoming' | 'missed') {
  const who = ev.callerName ? `${ev.callerName} (${ev.phone})` : ev.phone;
  const title = kind === 'missed' ? `Missed call from ${who}` : `Incoming call from ${who}`;
  const body = 'Not in your CRM yet — save it as a lead?';
  try {
    const { notifyBusinessUsers } = await import('@/services/notifications');
    await notifyBusinessUsers(businessId, { type: kind === 'missed' ? 'crm_missed_call' : 'crm_incoming_call', title, body, link: '/dashboard/crm?calls=1' });
  } catch { /* best-effort */ }
  try {
    const { sendPushToBusinessUsers } = await import('@/services/push');
    await sendPushToBusinessUsers(businessId, { title, body, data: { callEventId: String(ev._id) } });
  } catch { /* best-effort */ }
}

export async function recordCallEvent(business: { _id: any; organizationId: any }, e: NormalizedCallEvent): Promise<{ callEvent: any; matchedLeadId: string | null }> {
  await dbConnect();
  const { CallEvent } = await deps();
  const businessId = String(business._id);
  const phone = normalizePhoneE164(e.phone) || e.phone;
  let ev: any = await CallEvent.findOne({ provider: e.provider, callId: e.callId });
  const firstSight = !ev;
  if (!ev) {
    try {
      ev = await CallEvent.create({
        businessId: business._id, provider: e.provider, callId: e.callId, direction: e.direction, phone,
        callerName: e.callerName, outcome: nextOutcome(null, e.kind), startedAt: e.at, leadState: 'pending',
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      ev = await CallEvent.findOne({ provider: e.provider, callId: e.callId });
    }
  }
  if (String(ev.businessId) !== businessId) return { callEvent: ev, matchedLeadId: null }; // never cross workspaces
  const prevOutcome = ev.outcome;
  ev.outcome = nextOutcome(prevOutcome, e.kind);
  if (e.kind === 'call_ended' || e.kind === 'call_missed') ev.endedAt = e.at;
  if (e.durationSec != null) ev.durationSec = e.durationSec;
  if (!ev.callerName && e.callerName) ev.callerName = e.callerName;

  let matchedLeadId: string | null = ev.leadId ? String(ev.leadId) : null;
  if (firstSight) {
    const lead = await findCustomerLeadMatch(businessId, phone, null);
    if (lead) {
      ev.leadId = lead._id;
      ev.leadState = 'existing_lead';
      matchedLeadId = String(lead._id);
      lead.lastContactedAt = e.at;
      lead.lastActivityAt = e.at;
      await lead.save();
      await logLeadActivity(lead, {
        type: 'call',
        content: `${e.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call${ev.callerName ? ` from ${ev.callerName}` : ''} (${phone}) — ${fmtTime(e.at)}`,
        metadata: { callEventId: String(ev._id), provider: e.provider, callId: e.callId, direction: e.direction },
      });
    }
  }
  await ev.save();

  if (ev.leadState === 'pending' && e.direction === 'inbound') {
    if (firstSight) await askOwner(businessId, ev, ev.outcome === 'missed' ? 'missed' : 'incoming');
    else if (ev.outcome === 'missed' && prevOutcome !== 'missed') await askOwner(businessId, ev, 'missed');
  } else if (matchedLeadId && ev.outcome === 'missed' && prevOutcome !== 'missed') {
    const { default: Lead } = await import('@/models/Lead');
    const lead: any = await Lead.findById(matchedLeadId);
    if (lead) await logLeadActivity(lead, { type: 'call', content: `Missed call from ${phone} — ${fmtTime(e.at)}`, metadata: { callEventId: String(ev._id), missed: true } });
  }
  return { callEvent: ev, matchedLeadId };
}

export type CallActionResult = { ok: true; callEvent: any; lead?: any; created?: boolean } | { ok: false; status: number; error: string };

/** "Save as lead" — through the canonical lead service; an existing lead with this phone is reused. */
export async function saveCallAsLead(opts: {
  businessId: string; organizationId: string; callEventId: string; userId?: string | null;
  name?: string | null; notes?: string | null; createCallbackTask?: boolean;
}): Promise<CallActionResult> {
  await dbConnect();
  const { CallEvent } = await deps();
  if (!mongoose.isValidObjectId(opts.callEventId)) return { ok: false, status: 404, error: 'Call not found' };
  const ev: any = await CallEvent.findOne({ _id: opts.callEventId, businessId: opts.businessId });
  if (!ev) return { ok: false, status: 404, error: 'Call not found' };
  const { lead, created } = await createOrUpdateCustomerLead({
    businessId: opts.businessId, organizationId: opts.organizationId,
    name: opts.name || ev.callerName || null, phone: ev.phone, source: 'Phone Call', notes: opts.notes || null, createdBy: opts.userId,
    activity: {
      type: 'call',
      content: `${ev.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call${ev.outcome === 'missed' ? ' (missed)' : ''} — ${fmtTime(new Date(ev.startedAt))}${ev.durationSec ? `, ${ev.durationSec}s` : ''}`,
      metadata: { callEventId: String(ev._id), provider: ev.provider, callId: ev.callId, direction: ev.direction, outcome: ev.outcome },
      createdBy: opts.userId,
    },
  });
  if (!lead) return { ok: false, status: 400, error: 'Could not save this caller.' };
  lead.lastContactedAt = ev.startedAt;
  await lead.save();
  ev.leadId = lead._id;
  ev.leadState = created ? 'saved' : 'existing_lead';
  ev.handledBy = opts.userId && mongoose.isValidObjectId(opts.userId) ? opts.userId : null;
  ev.handledAt = new Date();
  await ev.save();
  if (opts.createCallbackTask) {
    const { createFollowUpTask } = await import('./followUps');
    await createFollowUpTask({ businessId: opts.businessId, organizationId: opts.organizationId, leadId: String(lead._id), dueAt: new Date(Date.now() + 60 * 60_000), type: 'Call', note: 'Call back this lead.', createdBy: opts.userId });
  }
  return { ok: true, callEvent: ev, lead, created };
}

/** "Existing lead" — attach the call to a lead the owner picks (same workspace only). */
export async function linkCallToLead(opts: { businessId: string; callEventId: string; leadId: string; userId?: string | null }): Promise<CallActionResult> {
  await dbConnect();
  const { CallEvent } = await deps();
  const { default: Lead } = await import('@/models/Lead');
  if (!mongoose.isValidObjectId(opts.callEventId) || !mongoose.isValidObjectId(opts.leadId)) return { ok: false, status: 404, error: 'Not found' };
  const ev: any = await CallEvent.findOne({ _id: opts.callEventId, businessId: opts.businessId });
  const lead: any = await Lead.findOne({ _id: opts.leadId, businessId: opts.businessId });
  if (!ev || !lead) return { ok: false, status: 404, error: 'Not found' };
  ev.leadId = lead._id;
  ev.leadState = 'existing_lead';
  ev.handledBy = opts.userId && mongoose.isValidObjectId(opts.userId) ? opts.userId : null;
  ev.handledAt = new Date();
  await ev.save();
  lead.lastContactedAt = ev.startedAt;
  lead.lastActivityAt = new Date();
  await lead.save();
  await logLeadActivity(lead, { type: 'call', content: `Call from ${ev.phone}${ev.outcome === 'missed' ? ' (missed)' : ''} — ${fmtTime(new Date(ev.startedAt))}`, metadata: { callEventId: String(ev._id) }, createdBy: opts.userId });
  return { ok: true, callEvent: ev, lead };
}

export async function dismissCall(opts: { businessId: string; callEventId: string; userId?: string | null }): Promise<CallActionResult> {
  await dbConnect();
  const { CallEvent } = await deps();
  if (!mongoose.isValidObjectId(opts.callEventId)) return { ok: false, status: 404, error: 'Call not found' };
  const ev: any = await CallEvent.findOneAndUpdate(
    { _id: opts.callEventId, businessId: opts.businessId, leadState: 'pending' },
    { $set: { leadState: 'dismissed', handledBy: opts.userId && mongoose.isValidObjectId(opts.userId) ? opts.userId : null, handledAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!ev) return { ok: false, status: 404, error: 'Call not found or already handled' };
  return { ok: true, callEvent: ev };
}

export async function businessForCalledNumber(number: string): Promise<any | null> {
  await dbConnect();
  const { Business } = await deps();
  const raw = String(number || '').trim();
  const bare = raw.replace(/\+/g, '');
  const forms = Array.from(new Set([raw, bare, `+${bare}`].filter(Boolean)));
  return Business.findOne({
    $or: [
      { 'integrations.whatsappNumber': { $in: forms } },
      { 'whatsappConfig.businessPhone': { $in: forms } },
    ],
  });
}
