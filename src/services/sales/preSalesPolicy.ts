import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Lead from '@/models/Lead';
import SalesConversation from '@/models/SalesConversation';
import BookingConversation from '@/models/BookingConversation';
import SupportConversation from '@/models/SupportConversation';
import DemoBooking from '@/models/DemoBooking';
import ScheduledAction from '@/models/ScheduledAction';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { logLeadEvent } from '@/services/leadEvents';
import {
  analysisOutcomeForAttendance,
  attendedFollowUpAllowed,
  confirmedAttendance,
  conversationSalesBlockedReason,
  demoHasEnded,
  demoTimeKey,
  leadPreSalesBlockedReason,
  MISSED_DEMO_MESSAGE_DELAY_MINUTES,
  minutesUntilSalesSendable,
  POST_DEMO_FOLLOW_UP_DELAY_MINUTES,
  postDemoKindFor,
  postDemoMessage,
  STAFF_ATTENDANCE_OUTCOMES,
  statusForAttendance,
  workspaceStartedTrialOrPaid,
  type SalesSendKind,
  type StaffAttendanceOutcome,
} from '@/lib/preSalesRules';

/**
 * Applies lib/preSalesRules.ts to live records. Every scheduled sales send
 * (invitation, follow-up, drip row, post-demo message) calls
 * preSalesSendBlockedReason immediately before sending, so a job queued days
 * ago re-checks the person's CURRENT state. Fails closed.
 */

const PLATFORM_TENANT = 'gmbboost-internal';
/** Generic sales/nurture rows. Demo reminders, the no-show check and post-demo messages are not generic. */
const NON_GENERIC_ACTIONS = ['DEMO_REMINDER', 'NO_SHOW_CHECK', 'FOLLOW_UP_AFTER_DEMO'];

async function findPlatformLead(phone: string | null | undefined, leadId?: unknown): Promise<any | null> {
  if (leadId) {
    const byId = await Lead.findById(leadId).lean();
    if (byId) return byId;
  }
  if (!phone) return null;
  return Lead.findOne({ phone: normalizePhoneE164(phone) || phone, tenantId: PLATFORM_TENANT }).lean();
}

/**
 * Has this person's workspace started a trial or paid? Checks the
 * conversation's own business AND every business owned by a user with this
 * phone — so it holds even when no platform Lead matches the phone.
 */
export async function trialOrPaidForPhone(phone: string | null | undefined, businessId?: unknown): Promise<boolean> {
  const select = 'subscriptionStatus trialStartedAt billingSubscriptionId userId';
  const ids: unknown[] = businessId ? [businessId] : [];
  const normalized = phone ? normalizePhoneE164(phone) || phone : null;
  const users: any[] = normalized
    ? await User.find({ phone: { $in: [...new Set([normalized, phone])] } }).select('_id subscriptionPlan').lean()
    : [];
  if (users.some((u) => workspaceStartedTrialOrPaid(null, u.subscriptionPlan))) return true;
  const or = [
    ...(ids.length ? [{ _id: { $in: ids } }] : []),
    ...(users.length ? [{ userId: { $in: users.map((u) => u._id) } }] : []),
  ];
  // Nothing to match on → no workspace (an empty $or would match EVERY business).
  if (!or.length) return false;
  const businesses: any[] = await Business.find({ $or: or }).select(select).lean();
  if (businesses.some((b) => workspaceStartedTrialOrPaid(b))) return true;
  // The conversation's business owner (if not already matched by phone).
  const ownerIds = businesses.map((b) => b.userId).filter(Boolean);
  if (ownerIds.length) {
    const owners: any[] = await User.find({ _id: { $in: ownerIds } }).select('subscriptionPlan').lean();
    if (owners.some((u) => workspaceStartedTrialOrPaid(null, u.subscriptionPlan))) return true;
  }
  return false;
}

/**
 * Why an automated sales message of this kind must not go out now, or null.
 * conversationId: the SalesConversation it belongs to (invite / follow-up).
 * Any lookup failure → 'eligibility-check-failed' (skip, never send).
 */
export async function preSalesSendBlockedReason(input: {
  kind: SalesSendKind;
  conversationId?: string;
  step?: 'consent' | 'first';
  phone?: string | null;
  leadId?: unknown;
  businessId?: unknown;
  /** post-demo: the booking the message is about (not counted as "demo in progress"). */
  bookingId?: unknown;
}): Promise<string | null> {
  try {
    await dbConnect();
    let phone = input.phone || null;
    let businessId = input.businessId;
    if (input.conversationId) {
      const convo: any = await SalesConversation.findById(input.conversationId)
        .select('status consentStatus firstSentAt lastLeadReplyAt leadPhone businessId').lean();
      const convoReason = conversationSalesBlockedReason(convo, input.kind, input.step);
      if (convoReason) return convoReason;
      phone = convo.leadPhone || phone;
      businessId = businessId || convo.businessId;
    }
    if (!phone && !input.leadId) return 'no-recipient';

    const lead = await findPlatformLead(phone, input.leadId);
    phone = phone || lead?.phone || null;
    const leadReason = leadPreSalesBlockedReason(lead, input.kind);
    if (leadReason) return leadReason;

    if (await trialOrPaidForPhone(phone, businessId)) return 'trial-or-paid';

    const key = phone ? phoneDedupeKey(phone) : null;
    if (input.kind !== 'post-demo') {
      // Someone is already talking to them, or a demo is in hand.
      if (key && await BookingConversation.exists({ phoneKey: key, status: { $in: ['active', 'awaiting_slot_selection', 'booked'] } })) return 'demo-in-progress';
      if (key && await SupportConversation.exists({ phoneKey: key, status: 'active' })) return 'support-conversation-active';
      if (lead?._id && await DemoBooking.exists({ leadId: lead._id, status: { $in: ['Pending', 'Confirmed'] } })) return 'demo-booked';
    } else if (lead?._id && input.bookingId) {
      // A newer booking replaces this one's follow-up.
      if (await DemoBooking.exists({ leadId: lead._id, _id: { $ne: input.bookingId }, status: { $in: ['Pending', 'Confirmed'] } })) return 'demo-rebooked';
    }
    return null;
  } catch (err: any) {
    console.warn('[preSales] eligibility check failed — skipping the send:', err?.message);
    return 'eligibility-check-failed';
  }
}

/** Claims one named automated send on a conversation (atomic). False → already sent or in flight. */
export async function claimSalesSend(conversationId: string, key: string): Promise<boolean> {
  const res = await SalesConversation.updateOne(
    { _id: conversationId, nurtureSentKeys: { $ne: key } },
    { $addToSet: { nurtureSentKeys: key } }
  );
  return res.modifiedCount === 1;
}

/** Gives a claim back after a send that did not go out, so a retry can try again. */
export async function releaseSalesSend(conversationId: string, key: string): Promise<void> {
  await SalesConversation.updateOne({ _id: conversationId }, { $pull: { nurtureSentKeys: key } }).catch(() => {});
}

/** Cancels the lead's pending generic sales rows (drip + next-best-action). Demo reminders stay. */
export async function cancelGenericSalesActions(leadId: unknown, reason: string): Promise<number> {
  if (!leadId) return 0;
  const res = await ScheduledAction.updateMany(
    { leadId, status: 'PENDING', actionType: { $nin: NON_GENERIC_ACTIONS } },
    { $set: { status: 'CANCELLED', reason } }
  );
  await Lead.updateOne({ _id: leadId }, { $set: { nextActionAt: null } }).catch(() => {});
  if (res.modifiedCount) {
    logLeadEvent('NURTURE_ACTION_CANCELLED', { reason, count: res.modifiedCount }, 'system', { leadId: leadId as any });
  }
  return res.modifiedCount;
}

/**
 * A trial started or a payment landed: take this workspace's owner out of
 * pre-sales nurture now — by business id AND by the owner's phone, so it
 * works even when no platform Lead matches. Best-effort; never throws.
 */
export async function stopPreSalesNurtureForWorkspace(businessId: string, reason: string): Promise<{ conversations: number; actions: number }> {
  try {
    await dbConnect();
    const business: any = await Business.findById(businessId).select('userId phone').lean();
    const owner: any = business?.userId ? await User.findById(business.userId).select('phone').lean() : null;
    const phones = [owner?.phone, business?.phone].filter(Boolean) as string[];
    const keys = [...new Set(phones.map((p) => phoneDedupeKey(p)).filter(Boolean))] as string[];
    const convos = await SalesConversation.updateMany(
      { status: 'active', $or: [{ businessId }, ...(keys.length ? [{ phoneKey: { $in: keys } }] : [])] },
      { $set: { status: 'completed' } }
    );
    let actions = 0;
    for (const phone of phones) {
      const lead: any = await findPlatformLead(phone);
      if (lead?._id) actions += await cancelGenericSalesActions(lead._id, reason);
    }
    return { conversations: convos.modifiedCount, actions };
  } catch (err: any) {
    console.warn('[preSales] stopPreSalesNurtureForWorkspace failed:', err?.message);
    return { conversations: 0, actions: 0 };
  }
}

// ── Post-demo lifecycle ──────────────────────────────────────────────────────
//
// Booking status + attendance, and what each allows:
//   Confirmed ──(auto timeout, end+15m)──▶ No Show / attendance unconfirmed  → no message, lead untouched
//   Confirmed | Completed | No Show ──(staff confirms, after the demo end)──▶
//     attended  → Completed / attended  → one follow-up (unless the analysis contradicts it)
//     no_show   → No Show   / no_show   → one rescheduling message
//     declined  → Completed / declined  → none (lead marked not interested)
//     not_ready → Completed / not_ready → none
// A reschedule (new startUtc) makes the old attendance stale (unknown) and
// lets the new demo time have its own single message.

const ATTENDANCE_EDITABLE_STATUSES = ['Confirmed', 'Completed', 'No Show'];

/**
 * A person records what happened at a demo. Refused before the recorded end
 * time, for bookings with no recorded time, and for pending / cancelled /
 * rescheduled bookings. Updates the booking atomically, runs the existing
 * post-demo analysis (lead hand-back, intent), and schedules the one allowed
 * message. Re-confirming is safe: the message is claimed once per demo time.
 */
export async function confirmDemoAttendance(input: {
  bookingId: string;
  outcome: StaffAttendanceOutcome;
  staffUserId?: string | null;
  now?: Date;
}): Promise<{ ok: true; scheduled: boolean } | { ok: false; status: number; error: string }> {
  await dbConnect();
  const now = input.now || new Date();
  if (!(STAFF_ATTENDANCE_OUTCOMES as readonly string[]).includes(input.outcome)) {
    return { ok: false, status: 400, error: 'Unknown attendance outcome' };
  }
  const booking: any = await DemoBooking.findById(input.bookingId).lean();
  if (!booking) return { ok: false, status: 404, error: 'Booking not found' };
  if (!ATTENDANCE_EDITABLE_STATUSES.includes(booking.status)) {
    return { ok: false, status: 409, error: `A ${booking.status} booking has no demo outcome to record` };
  }
  const ended = demoHasEnded(booking, now);
  if (ended === null) return { ok: false, status: 409, error: 'This booking has no recorded demo time' };
  if (!ended) return { ok: false, status: 409, error: 'The demo has not reached its scheduled end time yet' };

  // Conditional on the demo time we just checked, so a concurrent reschedule wins.
  const updated: any = await DemoBooking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ATTENDANCE_EDITABLE_STATUSES }, startUtc: booking.startUtc ?? null },
    {
      $set: {
        status: statusForAttendance(input.outcome),
        attendance: {
          outcome: input.outcome,
          source: 'staff',
          forStartUtc: booking.startUtc ?? null,
          at: now,
          ...(input.staffUserId && mongoose.isValidObjectId(input.staffUserId) ? { by: input.staffUserId } : {}),
        },
      },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) return { ok: false, status: 409, error: 'The booking changed — reload and try again' };

  // A pending message for a DIFFERENT outcome of this booking is no longer
  // right. (Re-confirming the same outcome keeps its message.)
  const newKind = postDemoKindFor(input.outcome);
  await ScheduledAction.updateMany(
    {
      actionType: 'FOLLOW_UP_AFTER_DEMO', status: 'PENDING', 'payload.bookingId': String(booking._id),
      ...(newKind ? { 'payload.kind': { $ne: newKind } } : {}),
    },
    { $set: { status: 'CANCELLED', reason: 'attendance-changed' } }
  );

  // Existing lifecycle: hand the lead back to SALES with the outcome merged
  // into its intent (declined → NOT_INTERESTED stops all sales messages).
  let analysisOutcome: string | null = null;
  if (booking.leadId) {
    const convo: any = await BookingConversation.findOne({ bookingId: booking._id }).lean();
    const history = (convo?.messages || []).map((m: any) => ({ role: m.role === 'lead' ? 'lead' as const : 'agent' as const, text: m.text }));
    const { runPostDemoAnalysis } = await import('@/services/demo/postDemoAnalysis');
    const analysis = await runPostDemoAnalysis(booking.leadId, history, analysisOutcomeForAttendance(input.outcome));
    analysisOutcome = analysis?.outcome ?? null;
  }

  const kind = newKind;
  if (!kind) return { ok: true, scheduled: false };
  if (kind === 'attended' && !attendedFollowUpAllowed(analysisOutcome)) return { ok: true, scheduled: false };
  const scheduled = await schedulePostDemoFollowUp({ bookingId: String(booking._id), kind, outcome: analysisOutcome, now });
  return { ok: true, scheduled };
}

/**
 * Queues the one post-demo message for a staff-confirmed outcome. Requires
 * the confirmed attendance for the CURRENT demo time and a demo that has
 * ended. One row per (booking, demo time, kind); returns false otherwise.
 */
export async function schedulePostDemoFollowUp(input: {
  bookingId: string | mongoose.Types.ObjectId;
  kind: 'attended' | 'missed';
  outcome?: string | null;
  now?: Date;
}): Promise<boolean> {
  try {
    await dbConnect();
    const now = input.now || new Date();
    const booking: any = await DemoBooking.findById(input.bookingId).select('leadId status startUtc endUtc attendance').lean();
    if (!booking?.leadId) return false;
    if (postDemoKindFor(confirmedAttendance(booking)) !== input.kind) return false;
    if (demoHasEnded(booking, now) !== true) return false;
    if (input.kind === 'attended' && !attendedFollowUpAllowed(input.outcome)) return false;
    const timeKey = demoTimeKey(booking);
    const base = new Date(now.getTime() + (input.kind === 'attended' ? POST_DEMO_FOLLOW_UP_DELAY_MINUTES : MISSED_DEMO_MESSAGE_DELAY_MINUTES) * 60_000);
    const dueAt = new Date(base.getTime() + minutesUntilSalesSendable(base) * 60_000);
    // One row per (booking, demo time, kind). The latest confirmation is the
    // source of truth: a row cancelled along the way (e.g. by the lead
    // hand-back that just ran, or an earlier correction) is re-activated —
    // but never one that already EXECUTED. Every send is re-checked and
    // claimed on the booking anyway, so this can't produce a second message.
    await ScheduledAction.findOneAndUpdate(
      { idempotencyKey: `${booking.leadId}-FOLLOW_UP_AFTER_DEMO-${booking._id}-${timeKey}-${input.kind}`, status: { $ne: 'EXECUTED' } },
      {
        $set: {
          leadId: booking.leadId,
          actionType: 'FOLLOW_UP_AFTER_DEMO',
          dueAt,
          status: 'PENDING',
          claimedAt: null,
          createdBy: 'post-demo',
          payload: { bookingId: String(booking._id), kind: input.kind, outcome: input.outcome || null, forStartUtc: timeKey },
        },
        $unset: { reason: '' },
      },
      { upsert: true }
    );
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return false; // this demo time's message already went out (EXECUTED row), or a concurrent upsert won
    console.warn('[preSales] schedulePostDemoFollowUp failed:', err?.message);
    return false;
  }
}

/**
 * Sends a due FOLLOW_UP_AFTER_DEMO row (nurtureSchedulerTick). Everything is
 * re-read at fire time: the staff-confirmed attendance for the current demo
 * time must still match this row, the demo must have ended, the lead must be
 * eligible (opt-out, human handoff, not interested, trial/paid, rebooked),
 * and they must not have written since the demo. Then one atomic claim per
 * booking + demo time, so concurrent ticks or a corrected outcome can never
 * produce a second message. After an attended follow-up, the lead's sales
 * conversation is reopened so a reply reaches the sales agent; a missed-demo
 * reply ("RESCHEDULE") stays with the booking thread's rescheduling flow.
 */
export async function sendPostDemoFollowUp(action: any): Promise<{ sent: boolean; reason?: string }> {
  await dbConnect();
  const kind: 'attended' | 'missed' = action.payload?.kind === 'missed' ? 'missed' : 'attended';
  const booking: any = await DemoBooking.findById(action.payload?.bookingId).lean();
  if (!booking) return { sent: false, reason: 'booking-missing' };
  const timeKey = demoTimeKey(booking);
  if (action.payload?.forStartUtc && action.payload.forStartUtc !== timeKey) return { sent: false, reason: 'demo-rescheduled' };
  const confirmed = confirmedAttendance(booking);
  if (postDemoKindFor(confirmed) !== kind) return { sent: false, reason: `attendance-now-${confirmed || 'unknown'}` };
  if (booking.status !== statusForAttendance(confirmed!)) return { sent: false, reason: `booking-now-${booking.status}` };
  if (demoHasEnded(booking) !== true) return { sent: false, reason: 'demo-not-yet-over' };
  if (booking.postDemoMessageFor === timeKey) return { sent: false, reason: 'already-sent' };

  const blocked = await preSalesSendBlockedReason({ kind: 'post-demo', leadId: action.leadId, phone: booking.phone, bookingId: booking._id });
  if (blocked) return { sent: false, reason: blocked };

  const key = phoneDedupeKey(booking.phone);
  const since = booking.endUtc || booking.startUtc;
  if (since && key) {
    const repliedSales = await SalesConversation.exists({ phoneKey: key, lastLeadReplyAt: { $gt: since } });
    const repliedBooking = await BookingConversation.exists({ phoneKey: key, messages: { $elemMatch: { role: 'lead', at: { $gt: since } } } });
    if (repliedSales || repliedBooking) return { sent: false, reason: 'lead-engaged-after-demo' };
  }

  const { getSalesAgentConfig } = await import('@/services/sales/salesAgent');
  const config = await getSalesAgentConfig();
  const text = postDemoMessage({
    kind,
    name: booking.name,
    businessName: booking.company,
    outcome: action.payload?.outcome,
    whenLabel: booking.date && booking.timeSlot ? `${booking.date} at ${booking.timeSlot}` : null,
    subscribeUrl: config.subscribeUrl || null,
  });
  if (!text) return { sent: false, reason: 'outcome-no-follow-up' };

  // One message per booking + demo time, whatever races us.
  const claim = await DemoBooking.updateOne(
    { _id: booking._id, postDemoMessageFor: { $ne: timeKey } },
    { $set: { postDemoMessageFor: timeKey } }
  );
  if (claim.modifiedCount !== 1) return { sent: false, reason: 'already-sent' };

  const { sendOutboundMessage } = await import('@/services/whatsapp/send');
  const res = await sendOutboundMessage(booking.phone, text, String(action.leadId));
  if (!res.success) {
    await DemoBooking.updateOne({ _id: booking._id, postDemoMessageFor: timeKey }, { $unset: { postDemoMessageFor: '' } });
    return { sent: false, reason: `send-failed: ${res.error || 'unknown'}` };
  }

  const now = new Date();
  if (kind === 'attended' && key) {
    // The demo is over — replies belong to the sales conversation again.
    await BookingConversation.updateMany({ phoneKey: key, bookingId: booking._id, status: 'booked' }, { $set: { status: 'stopped' } });
    const convo: any = await SalesConversation.findOne({ phoneKey: key }).sort({ updatedAt: -1 });
    if (convo) {
      convo.status = 'active';
      convo.consentStatus = convo.consentStatus === 'pending' ? 'granted' : convo.consentStatus;
      convo.messages.push({ role: 'agent', text, at: now });
      convo.lastAgentAt = now;
      await convo.save();
    }
  } else if (key) {
    await BookingConversation.updateOne(
      { phoneKey: key, bookingId: booking._id },
      { $push: { messages: { role: 'agent', text, at: now } } }
    );
  }
  logLeadEvent('MESSAGE_SENT', { channel: 'whatsapp', agent: 'DEMO', isReply: false, sid: res.sid, source: kind === 'attended' ? 'POST_DEMO_FOLLOW_UP' : 'MISSED_DEMO_RESCHEDULE' }, 'demo-agent', {
    leadId: action.leadId, phone: booking.phone,
  });
  return { sent: true };
}
