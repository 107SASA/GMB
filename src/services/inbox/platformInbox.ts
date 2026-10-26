import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import SalesConversation from '@/models/SalesConversation';
import BookingConversation from '@/models/BookingConversation';
import SupportConversation from '@/models/SupportConversation';
import ReportConversation from '@/models/ReportConversation';
import WhatsAppThread from '@/models/WhatsAppThread';
import WhatsAppMessage from '@/models/WhatsAppMessage';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import DemoBooking from '@/models/DemoBooking';
import Business from '@/models/Business';
import User from '@/models/User';
import ScheduledAction from '@/models/ScheduledAction';
import Subscription from '@/models/Subscription';
import MessageQueue from '@/models/MessageQueue';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import { normalizePhoneE164 } from '@/lib/phone';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import { sendTemplateMessage } from '@/services/twilio/client';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';
import { buildNotificationVariables, realInboundAtFromMessages, recipientFirstName } from '@/lib/whatsappOutbound';
import { setLeadOwnership } from '@/services/leadOwnership/setLeadOwnership';
import { releaseFromHuman } from '@/services/leadOwnership/releaseFromHuman';
import { logLeadEvent } from '@/services/leadEvents';
import { phoneDedupeKey } from '@/lib/phone';
import { sendPushToSuperAdmins } from '@/services/push';
import { ensureThreadsBackfilled, threadForPhone, withWhatsAppSendContext } from '@/services/inbox/whatsappLog';
import { THREAD_KIND_LABEL, needsReply, threadKind, threadUnread, type ThreadKind } from '@/services/inbox/whatsappLogRules';
import {
  duplicateClientKey,
  matchesInboxFilter,
  messageKind,
  outboundBlockedReason,
  ownershipLabel,
  scoreBand,
  sessionWindowOpen,
  type InboxFilter,
} from '@/services/inbox/inboxRules';

const PLATFORM = 'gmbboost-internal';
const LIST_LIMIT = 300;
const OPEN_BOOKING = ['active', 'awaiting_slot_selection', 'booked'];

/**
 * The Super Admin WhatsApp Inbox: every chat on the GrowwMatics platform line,
 * one row per phone number (WhatsAppThread, written by services/inbox/
 * whatsappLog.ts) — sales, demo, support, free report, review replies and
 * first contacts. A row's id is `wa:<threadId>`; the older `sales:<id>` /
 * `booking:<id>` ids still open the same chat.
 */
function threadRef(id: unknown): string {
  return `wa:${String(id)}`;
}

function parseRef(value: string): { kind: 'wa' | 'sales' | 'booking'; id: string } | null {
  const [kind, id] = String(value || '').split(':');
  if ((kind !== 'wa' && kind !== 'sales' && kind !== 'booking') || !mongoose.Types.ObjectId.isValid(id || '')) return null;
  return { kind, id };
}

async function leadByPhone(phone: string) {
  const normalized = normalizePhoneE164(phone) || phone;
  return Lead.findOne({ phone: normalized, tenantId: PLATFORM }).lean() as Promise<any>;
}

function kolkataDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function humanInboxSettings() {
  const doc = await SalesAgentConfig.findOne({ key: 'default' }).select('humanInboxEnabled humanInboxAssignOnTakeover').lean() as any;
  return {
    enabled: doc?.humanInboxEnabled !== false,
    assignOnTakeover: doc?.humanInboxAssignOnTakeover !== false,
  };
}

/** What kind of chat each number is, from its open conversations and lead. */
async function threadFacts(threads: any[], byPhone: Map<string, any>) {
  const keys = threads.map((thread) => thread.phoneKey);
  const [support, report, booking, sales] = await Promise.all([
    SupportConversation.find({ phoneKey: { $in: keys }, status: 'active' }).distinct('phoneKey'),
    ReportConversation.find({ phoneKey: { $in: keys }, status: { $ne: 'stopped' } }).distinct('phoneKey'),
    BookingConversation.find({ phoneKey: { $in: keys }, status: { $in: OPEN_BOOKING } }).distinct('phoneKey'),
    SalesConversation.find({ phoneKey: { $in: keys } }).distinct('phoneKey'),
  ]);
  const has = (list: unknown[]) => new Set(list.map(String));
  const s = { support: has(support), report: has(report), booking: has(booking), sales: has(sales) };
  return (thread: any): ThreadKind => {
    const lead = byPhone.get(thread.phone);
    return threadKind({
      supportOpen: s.support.has(thread.phoneKey),
      reviewReply: !!thread.reviewReply,
      demoOpen: s.booking.has(thread.phoneKey) || lead?.currentAgent === 'DEMO' || lead?.currentStage === 'DEMO_SCHEDULED',
      reportOpen: s.report.has(thread.phoneKey),
      salesThread: s.sales.has(thread.phoneKey),
      customer: !!thread.userId || lead?.currentStage === 'CUSTOMER' || lead?.currentAgent === 'IN_HOUSE',
    });
  };
}

function card(thread: any, lead: any, kind: ThreadKind) {
  const view = {
    currentAgent: lead?.currentAgent,
    currentStage: lead?.currentStage,
    intent: lead?.intent,
    nurtureStatus: lead?.nurtureStatus,
    humanHandoffActive: !!lead?.humanHandoff?.active,
    assignedUserId: lead?.assignedUserId ? String(lead.assignedUserId) : lead?.humanHandoff?.assignedUserId ? String(lead.humanHandoff.assignedUserId) : null,
    leadScore: typeof lead?.leadScore === 'number' ? lead.leadScore : 0,
    unread: threadUnread(thread),
    needsReply: needsReply(thread, kind),
    status: thread.status,
    kind,
  };
  return {
    id: threadRef(thread._id),
    name: lead?.name || thread.name || 'Unknown',
    phone: thread.phone,
    preview: String(thread.lastMessageText || '').slice(0, 90),
    lastDirection: thread.lastDirection,
    updatedAt: thread.lastMessageAt,
    unread: view.unread,
    needsReply: view.needsReply,
    kind,
    kindLabel: THREAD_KIND_LABEL[kind],
    leadScore: view.leadScore,
    band: scoreBand(view.leadScore),
    intent: lead?.intent || null,
    ownership: ownershipLabel(view, thread.status),
    status: thread.status,
    assignedUserId: view.assignedUserId,
    leadId: lead?._id ? String(lead._id) : null,
    filterView: view,
  };
}

/**
 * Saves an inbound message from a HUMAN-owned platform lead that has no live
 * sales or booking thread onto a conversation, so the agents' own history has
 * it too (the Inbox already has it from the webhook's record). Never triggers
 * an AI reply. Order: the most recent sales thread (any status), else the most
 * recent booking thread, else a new closed booking thread just to hold it. The
 * team is pushed a notification either way.
 */
export async function saveHumanOwnedInbound(input: { phone: string; body: string; profileName?: string; lead: any }): Promise<{ ref: string }> {
  await dbConnect();
  const key = phoneDedupeKey(input.phone);
  const now = new Date();
  const text = input.body || '[non-text message]';
  let saved: { kind: 'sales' | 'booking'; id: string } | null = null;

  const sales: any = key ? await SalesConversation.findOne({ phoneKey: key }).sort({ updatedAt: -1 }) : null;
  if (sales) {
    sales.messages.push({ role: 'lead', text, at: now });
    sales.lastLeadReplyAt = now;
    await sales.save();
    saved = { kind: 'sales', id: String(sales._id) };
  } else {
    let booking: any = key ? await BookingConversation.findOne({ phoneKey: key }).sort({ updatedAt: -1 }) : null;
    if (!booking) {
      booking = new BookingConversation({
        leadPhone: normalizePhoneE164(input.phone) || input.phone,
        phoneKey: key,
        leadName: input.lead?.name || input.profileName || '',
        leadId: input.lead?._id,
        // Closed: the booking agent never picks this thread up.
        status: 'stopped',
        messages: [],
      });
    }
    booking.messages.push({ role: 'lead', text, at: now, via: 'whatsapp' });
    booking.humanInboxAt = now;
    await booking.save();
    saved = { kind: 'booking', id: String(booking._id) };
  }

  await logLeadEvent('MESSAGE_RECEIVED', { channel: 'whatsapp', heldForHuman: true }, 'system', {
    leadId: input.lead?._id, phone: input.phone, conversationType: saved.kind, conversationId: new mongoose.Types.ObjectId(saved.id),
  });
  const thread = await threadForPhone(input.phone).catch(() => null);
  const ref = thread ? threadRef(thread._id) : `${saved.kind}:${saved.id}`;
  try {
    await sendPushToSuperAdmins({
      title: 'New message for human-owned lead',
      body: `${input.lead?.name || input.phone} sent a message (human-owned).`,
      data: { leadId: input.lead?._id ? String(input.lead._id) : '', conversation: ref },
    });
  } catch (err: any) {
    console.warn('[platformInbox] human-owned inbound push failed:', err?.message);
  }
  return { ref };
}

export async function listInbox(input: { q?: string; filter?: string; sort?: string; viewerUserId?: string }) {
  await dbConnect();
  await ensureThreadsBackfilled();
  const filter = (input.filter || 'all') as InboxFilter;
  const q = (input.q || '').trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

  let threadQuery: Record<string, unknown> = {};
  if (rx) {
    // Name, phone, email or lead id, and any message text — the Inbox's own
    // record and the older conversations.
    const leadMatch: any[] = [{ name: rx }, { phone: rx }, { email: rx }];
    if (mongoose.Types.ObjectId.isValid(q)) leadMatch.push({ _id: q });
    const textQuery = { 'messages.text': rx };
    const [leads, logged, sales, booking, support, report] = await Promise.all([
      Lead.find({ tenantId: PLATFORM, $or: leadMatch }).select('phone').limit(60).lean(),
      WhatsAppMessage.find({ text: rx }).sort({ at: -1 }).limit(300).distinct('phoneKey'),
      SalesConversation.find(textQuery).limit(60).distinct('phoneKey'),
      BookingConversation.find(textQuery).limit(60).distinct('phoneKey'),
      SupportConversation.find(textQuery).limit(60).distinct('phoneKey'),
      ReportConversation.find(textQuery).limit(60).distinct('phoneKey'),
    ]);
    const keys = new Set<string>([...logged, ...sales, ...booking, ...support, ...report].map(String));
    for (const lead of leads as any[]) { const key = phoneDedupeKey(lead.phone); if (key) keys.add(key); }
    const or: any[] = [{ name: rx }, { phone: rx }, { phoneKey: { $in: [...keys] } }];
    if (mongoose.Types.ObjectId.isValid(q)) or.push({ _id: q });
    threadQuery = { $or: or };
  }
  const threads: any[] = await WhatsAppThread.find(threadQuery).sort({ lastMessageAt: -1 }).limit(LIST_LIMIT).lean();

  const leads = await Lead.find({ tenantId: PLATFORM, phone: { $in: threads.map((thread) => thread.phone) } })
    .select('name phone email leadScore intent currentStage currentAgent nurtureStatus humanHandoff assignedUserId createdAt businessId')
    .lean();
  const byPhone = new Map((leads as any[]).map((lead) => [lead.phone, lead]));
  const kindOf = await threadFacts(threads, byPhone);
  const rows = threads.map((thread) => card(thread, byPhone.get(thread.phone), kindOf(thread)));

  const visible = rows.filter((row) => matchesInboxFilter(row.filterView, filter, input.viewerUserId));
  const latest = (a: any, b: any) => +new Date(b.updatedAt) - +new Date(a.updatedAt);
  if (input.sort === 'unread') visible.sort((a, b) => Number(b.unread) - Number(a.unread) || latest(a, b));
  else if (input.sort === 'needs-reply') visible.sort((a, b) => Number(b.needsReply) - Number(a.needsReply) || latest(a, b));
  else if (input.sort === 'score') visible.sort((a, b) => b.leadScore - a.leadScore);
  else if (input.sort === 'human') visible.sort((a, b) => Number(b.ownership === 'Human Owned') - Number(a.ownership === 'Human Owned') || latest(a, b));
  else if (input.sort === 'mine') visible.sort((a, b) => Number(b.assignedUserId === input.viewerUserId) - Number(a.assignedUserId === input.viewerUserId) || latest(a, b));
  else visible.sort(latest);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [failedMessages, demoToday] = await Promise.all([
    MessageQueue.countDocuments({ direction: 'OUTBOUND', status: 'FAILED', createdAt: { $gte: since } }),
    DemoBooking.countDocuments({ status: { $in: ['Pending', 'Confirmed'] }, date: kolkataDate() }),
  ]);
  const counts = {
    unread: rows.filter((row) => row.unread).length,
    needsReply: rows.filter((row) => row.needsReply).length,
    support: rows.filter((row) => row.kind === 'support').length,
    human: rows.filter((row) => row.ownership === 'Human Owned').length,
    mine: rows.filter((row) => row.assignedUserId === input.viewerUserId).length,
    highIntent: rows.filter((row) => row.leadScore >= 51).length,
    demoToday,
    failedMessages,
  };
  return { conversations: visible.map(({ filterView: _view, ...row }) => row), counts };
}

/** Thread, lead and the number's latest sales / demo conversation (the agents' own history). */
async function loadConversation(conversationRef: string) {
  const parsed = parseRef(conversationRef);
  if (!parsed) return null;
  let thread: any = null;
  let phone: string | null = null;
  if (parsed.kind === 'wa') {
    thread = await WhatsAppThread.findById(parsed.id);
    phone = thread?.phone || null;
  } else {
    const Model: any = parsed.kind === 'sales' ? SalesConversation : BookingConversation;
    const legacy: any = await Model.findById(parsed.id).select('leadPhone').lean();
    phone = legacy?.leadPhone || null;
    if (phone) thread = await threadForPhone(phone);
  }
  if (!phone) return null;
  const key = phoneDedupeKey(phone);
  const [sales, booking]: any[] = key
    ? await Promise.all([
      SalesConversation.findOne({ phoneKey: key }).sort({ updatedAt: -1 }),
      BookingConversation.findOne({ phoneKey: key }).sort({ updatedAt: -1 }),
    ])
    : [null, null];
  const convo = [sales, booking].filter(Boolean).sort((a: any, b: any) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0] || null;
  const lead = await leadByPhone(phone);
  return { thread, phone, phoneKey: key, convo, sales, booking, lead, kind: convo ? (convo === sales ? 'sales' : 'booking') : null };
}

/** The person's last real message, from the Inbox record or the conversation itself. */
function lastInboundAt(loaded: { thread: any; convo: any }): Date | null {
  const fromConvo = loaded.convo ? realInboundAtFromMessages(loaded.convo.messages, loaded.convo.lastLeadReplyAt) : null;
  const fromThread = loaded.thread?.lastInboundAt ? new Date(loaded.thread.lastInboundAt) : null;
  if (!fromConvo) return fromThread;
  if (!fromThread) return fromConvo;
  return fromConvo > fromThread ? fromConvo : fromThread;
}

const MESSAGE_LIMIT = 400;

export async function inboxDetail(conversationRef: string) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded) return null;
  const { thread, convo, sales, lead, phone, phoneKey } = loaded;
  const now = new Date();
  if (thread) await WhatsAppThread.updateOne({ _id: thread._id }, { $set: { lastReadAt: now } });
  if (convo) { convo.lastReadAt = now; await convo.save(); }

  // Everything the Inbox recorded, then the older conversation history from
  // before it existed (messages before the first recorded one).
  const logged: any[] = thread
    ? (await WhatsAppMessage.find({ threadId: thread._id }).sort({ at: -1 }).limit(MESSAGE_LIMIT).lean()).reverse()
    : [];
  const statuses = new Map(
    (await MessageQueue.find({ _id: { $in: logged.map((row) => row.queueId).filter(Boolean) } }).select('status deliveredAt readAt failedReason').lean() as any[])
      .map((row) => [String(row._id), row])
  );
  const firstLogged = logged.length ? new Date(logged[0].at).getTime() : Infinity;
  const older: any[] = [];
  if (phoneKey) {
    const convos: any[] = (await Promise.all([
      SalesConversation.find({ phoneKey }).select('messages').lean(),
      BookingConversation.find({ phoneKey }).select('messages').lean(),
      SupportConversation.find({ phoneKey }).select('messages').lean(),
      ReportConversation.find({ phoneKey }).select('messages').lean(),
    ])).flat();
    for (const row of convos) {
      for (const message of row.messages || []) {
        if (message?.at && new Date(message.at).getTime() < firstLogged) older.push(message);
      }
    }
  }
  older.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const messages = [
    ...older.slice(-MESSAGE_LIMIT).map((message: any) => ({
      role: message.role,
      kind: messageKind(message.role, message.sender),
      text: message.text,
      at: message.at,
      clientKey: message.clientKey || null,
      status: null as string | null,
      template: null as string | null,
    })),
    ...logged.map((row) => {
      const queue: any = row.queueId ? statuses.get(String(row.queueId)) : null;
      const status = !queue ? null : queue.readAt ? 'read' : queue.deliveredAt ? 'delivered' : queue.status === 'FAILED' ? 'failed' : queue.status === 'SENT' ? 'sent' : 'sending';
      return {
        role: row.direction === 'in' ? 'lead' : 'agent',
        kind: (row.direction === 'in' ? 'customer' : row.sender === 'team' ? 'human' : 'ai') as 'customer' | 'ai' | 'human',
        text: row.text,
        at: row.at,
        clientKey: row.clientKey || null,
        status,
        template: row.template || null,
      };
    }),
  ];

  const events = lead
    ? await LeadEvent.find({ $or: [{ leadId: lead._id }, { phone }] }).sort({ createdAt: -1 }).limit(40).lean()
    : [];
  const demo = lead ? await DemoBooking.findOne({ leadId: lead._id }).sort({ updatedAt: -1 }).lean() as any : null;
  const reminders = demo
    ? await ScheduledAction.find({ leadId: lead._id, actionType: 'DEMO_REMINDER', 'payload.bookingId': String(demo._id) }).select('status payload').lean()
    : [];
  const businessId = lead?.businessId || thread?.businessId;
  const business = businessId
    ? await Business.findById(businessId).select('name subscriptionStatus googleConnected city googleLocationId createdAt').lean() as any
    : null;
  const subscription = businessId
    ? await Subscription.findOne({ businessId }).select('planType billingStatus status startDate').lean() as any
    : null;
  const nextAction = lead
    ? await ScheduledAction.findOne({ leadId: lead._id, status: 'PENDING', actionType: { $nin: ['DEMO_REMINDER', 'NO_SHOW_CHECK'] } }).sort({ dueAt: 1 }).select('actionType dueAt reason').lean() as any
    : null;
  const view = {
    currentAgent: lead?.currentAgent,
    currentStage: lead?.currentStage,
    intent: lead?.intent,
    nurtureStatus: lead?.nurtureStatus,
    humanHandoffActive: !!lead?.humanHandoff?.active,
  };
  const kind: ThreadKind = thread
    ? (await threadFacts([thread], new Map(lead ? [[thread.phone, lead]] : [])))(thread)
    : 'new';
  const human = view.humanHandoffActive || lead?.currentAgent === 'HUMAN';
  const banner = human
    ? 'Human is handling this conversation'
    : kind === 'support'
      ? 'Support request — the customer got the automatic acknowledgement. Reply here; no bot answers support.'
      : kind === 'review-reply'
        ? "Reply from someone a customer's business asked for a review. No bot replies to them."
        : kind === 'new'
          ? 'New contact — the bot sent the welcome menu. Reply here to talk to them yourself.'
          : 'AI is handling this conversation';
  const status = thread?.status || (convo?.status === 'completed' || convo?.status === 'stopped' ? 'resolved' : 'open');

  return {
    id: thread ? threadRef(thread._id) : conversationRef,
    windowOpen: sessionWindowOpen(lastInboundAt(loaded)),
    blocked: lead ? outboundBlockedReason(lead) : null,
    banner,
    contact: {
      name: lead?.name || thread?.name || convo?.leadName || 'Unknown',
      phone,
      kind,
      kindLabel: THREAD_KIND_LABEL[kind],
      status,
    },
    lead: lead ? {
      id: String(lead._id),
      name: lead.name || convo?.leadName || null,
      phone: lead.phone,
      email: lead.email || null,
      company: lead.businessProfile?.name || convo?.scores?.businessName || null,
      createdAt: lead.createdAt,
      leadScore: lead.leadScore ?? 0,
      band: scoreBand(lead.leadScore ?? 0),
      intent: lead.intent || null,
      stage: lead.currentStage || null,
      nextBestAction: lead.nextBestAction || null,
      ownership: ownershipLabel(view, status),
      agent: lead.currentAgent || null,
      assignedUserId: lead.assignedUserId ? String(lead.assignedUserId) : null,
      painPoints: lead.painPoints || [],
      interests: [...(lead.businessProfile?.interestedServices || []), ...(lead.businessProfile?.goals || [])],
      questions: (lead.buyingSignals || []).filter((item: any) => String(item.type || '').includes('QUESTION')).map((item: any) => item.note || item.type),
      objections: (lead.objections || []).map((item: any) => item.note || item.type),
      buyingSignals: (lead.buyingSignals || []).map((item: any) => item.note || item.type),
      tags: lead.tags || [],
      notes: lead.notes || '',
      nurtureStatus: lead.nurtureStatus || null,
    } : null,
    nurture: sales ? {
      status: lead?.nurtureStatus || sales.status,
      followUpsSent: sales.followUpsSent || 0,
      version: sales.nurtureConfigVersion || null,
      lastAgentAt: sales.lastAgentAt || null,
      nextAction: nextAction?.actionType || null,
      nextAt: nextAction?.dueAt || null,
    } : null,
    demo: demo ? {
      id: String(demo._id),
      status: demo.status,
      date: demo.date,
      timeSlot: demo.timeSlot,
      timezone: demo.timezone || null,
      salesperson: demo.googleEmail || null,
      calendarEventId: demo.calendarEventId || null,
      meetingLink: demo.meetingLink || null,
      reminders: (reminders as any[]).map((row) => ({ type: row.payload?.reminderType, status: row.status })),
    } : null,
    customer: business ? {
      id: String(business._id),
      name: business.name,
      subscriptionStatus: business.subscriptionStatus || subscription?.billingStatus || null,
      plan: subscription?.planType || null,
      paymentStatus: subscription?.status || null,
      activationDate: subscription?.startDate || null,
      googleConnected: business.googleConnected === true,
      googleLocationId: business.googleLocationId || null,
      city: business.city || null,
      since: business.createdAt,
    } : null,
    messages,
    events: (events as any[]).map((event) => ({
      type: event.type,
      at: event.createdAt,
      actor: event.actor,
      payload: event.payload || {},
    })).reverse(),
  };
}

export async function sendInboxMessage(conversationRef: string, input: { text?: string; template?: string; clientKey?: string }, userId?: string) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded) return { ok: false as const, error: 'Conversation not found', status: 404 };
  const settings = await humanInboxSettings();
  if (!settings.enabled) return { ok: false as const, error: 'Human inbox is disabled.', status: 403 };
  const { convo, lead, thread, phone } = loaded;
  if (lead && outboundBlockedReason(lead)) {
    return { ok: false as const, error: 'This lead cannot be contacted.', status: 409 };
  }
  if (input.clientKey) {
    const sentBefore = (thread && await WhatsAppMessage.exists({ threadId: thread._id, clientKey: input.clientKey }))
      || (convo && duplicateClientKey(convo.messages || [], input.clientKey));
    if (sentBefore) return { ok: true as const, duplicate: true };
  }
  const open = sessionWindowOpen(lastInboundAt(loaded));
  let text = (input.text || '').trim();
  if (!open && input.template !== 'notification') {
    return { ok: false as const, error: 'WhatsApp customer-service window is closed. Select an approved template to continue.', status: 409 };
  }
  // Recorded in the Inbox as the team's message, by whoever sent it.
  const result = await withWhatsAppSendContext({ sender: 'team', userId, clientKey: input.clientKey }, async () => {
    if (!open) {
      if (!WA_TEMPLATES.notification) return { refused: true as const, error: 'The notification template is not configured.', status: 409 };
      text = text || 'A GrowwMatics teammate sent you an update.';
      const built = buildNotificationVariables(recipientFirstName(lead?.name || thread?.name || convo?.leadName), text);
      if (!built.ok) return { refused: true as const, error: built.error, status: 400 };
      return sendTemplateMessage(phone, WA_TEMPLATES.notification, built.variables);
    }
    if (!text) return { refused: true as const, error: 'Message is empty.', status: 400 };
    return sendOutboundMessage(phone, text, lead?._id?.toString());
  });
  if ('refused' in result) return { ok: false as const, error: result.error, status: result.status };
  if (!result.success) return { ok: false as const, error: 'Message failed to send', status: 502 };
  // The agents read their own conversation: the team's reply goes there too.
  if (convo) {
    convo.messages.push({ role: 'agent', text, at: new Date(), sender: 'human', clientKey: input.clientKey || undefined });
    convo.lastAgentAt = new Date();
    await convo.save();
  }
  return { ok: true as const, duplicate: false };
}

export async function takeOverInbox(conversationRef: string, userId: string) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded?.lead) return { ok: false as const, error: 'Lead not found', status: 404 };
  const settings = await humanInboxSettings();
  if (!settings.enabled) return { ok: false as const, error: 'Human inbox is disabled.', status: 403 };
  await setLeadOwnership(loaded.lead._id, 'HUMAN', 'inbox-takeover', userId);
  const set: Record<string, unknown> = {
    'humanHandoff.active': true,
    'humanHandoff.reason': 'inbox-takeover',
    'humanHandoff.since': new Date(),
  };
  if (settings.assignOnTakeover) {
    set.assignedUserId = userId;
    set['humanHandoff.assignedUserId'] = userId;
  }
  await Lead.updateOne({ _id: loaded.lead._id }, { $set: set });
  return { ok: true as const };
}

export async function returnInboxToAi(conversationRef: string, userId: string) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded?.lead) return { ok: false as const, error: 'Lead not found', status: 404 };
  const human = loaded.lead.currentAgent === 'HUMAN' || loaded.lead.humanHandoff?.active || loaded.lead.currentStage === 'HUMAN_HANDOFF';
  if (!human) return { ok: false as const, error: 'AI already owns this conversation.', status: 409 };
  const stage = loaded.lead.currentStage;
  const customer = stage === 'CUSTOMER';
  const demo = stage === 'DEMO_REQUESTED' || stage === 'DEMO_SCHEDULED' || stage === 'DEMO_COMPLETED';
  const target = customer ? 'IN_HOUSE' : demo ? 'DEMO' : 'SALES';
  const resume = customer ? 'CUSTOMER' : demo ? stage : (stage && stage !== 'HUMAN_HANDOFF' ? stage : 'NURTURING');
  await releaseFromHuman(loaded.lead._id, target, 'inbox-return-to-ai', userId, resume);
  return { ok: true as const };
}

export async function assignInbox(conversationRef: string, userId: string | null) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded?.lead) return { ok: false as const, error: 'Lead not found', status: 404 };
  if (userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return { ok: false as const, error: 'Unknown teammate.', status: 400 };
    const teammate = await User.findOne({ _id: userId, role: 'SUPER_ADMIN' }).select('_id');
    if (!teammate) return { ok: false as const, error: 'Unknown teammate.', status: 400 };
  }
  await Lead.updateOne(
    { _id: loaded.lead._id },
    userId
      ? { $set: { assignedUserId: userId, 'humanHandoff.assignedUserId': userId } }
      : { $unset: { assignedUserId: '', 'humanHandoff.assignedUserId': '' } }
  );
  logLeadEvent('AGENT_HANDOFF', { reason: userId ? 'inbox-assign' : 'inbox-unassign', assignedUserId: userId }, 'inbox', { leadId: loaded.lead._id, phone: loaded.lead.phone });
  return { ok: true as const };
}

/**
 * Resolve: the team has handled this chat — it leaves the open views, and an
 * open support issue is closed (the next message opens a new one, with its
 * own acknowledgement). It does not stop a bot; Take Over does that. A new
 * message from the person reopens the chat.
 */
export async function resolveInbox(conversationRef: string, reopen: boolean) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded) return { ok: false as const, error: 'Conversation not found', status: 404 };
  const thread = loaded.thread || await threadForPhone(loaded.phone);
  if (!thread) return { ok: false as const, error: 'Conversation not found', status: 404 };
  const now = new Date();
  if (reopen) {
    await WhatsAppThread.updateOne({ _id: thread._id }, { $set: { status: 'open' }, $unset: { resolvedAt: '' } });
    return { ok: true as const };
  }
  await WhatsAppThread.updateOne({ _id: thread._id }, { $set: { status: 'resolved', resolvedAt: now, lastReadAt: now } });
  if (loaded.phoneKey) {
    await SupportConversation.updateMany(
      { phoneKey: loaded.phoneKey, status: 'active' },
      { $set: { status: 'closed', closedAt: now, closedReason: 'resolved' } }
    );
  }
  return { ok: true as const };
}

export async function saveInboxNotes(conversationRef: string, input: { note?: string; tags?: string[] }) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded?.lead) return { ok: false as const, error: 'Lead not found', status: 404 };
  const update: any = {};
  if (typeof input.note === 'string' && input.note.trim()) {
    const line = `${new Date().toISOString().slice(0, 16)} ${input.note.trim()}`;
    update.notes = [loaded.lead.notes, line].filter(Boolean).join('\n').slice(-4000);
  }
  if (update.notes) await Lead.updateOne({ _id: loaded.lead._id }, { $set: { notes: update.notes } });
  if (Array.isArray(input.tags)) {
    await Lead.updateOne({ _id: loaded.lead._id }, { $set: { tags: input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20) } });
  }
  return { ok: true as const };
}

export async function inboxTeam() {
  await dbConnect();
  const users = await User.find({ role: 'SUPER_ADMIN' }).select('fullName email role').limit(50).lean();
  const counts = await Lead.aggregate([
    { $match: { tenantId: PLATFORM, assignedUserId: { $ne: null } } },
    { $group: { _id: '$assignedUserId', count: { $sum: 1 } } },
  ]);
  const byUser = new Map(counts.map((row: any) => [String(row._id), row.count]));
  return (users as any[]).map((user) => ({
    id: String(user._id),
    name: user.fullName || user.email,
    email: user.email,
    role: user.role,
    activeConversations: byUser.get(String(user._id)) || 0,
  }));
}

export async function cancelInboxDemo(conversationRef: string, userId: string) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded?.lead) return { ok: false as const, error: 'Lead not found', status: 404 };
  const demo: any = await DemoBooking.findOne({ leadId: loaded.lead._id, status: { $in: ['Pending', 'Confirmed'] } }).sort({ updatedAt: -1 });
  if (!demo) return { ok: false as const, error: 'No active demo to cancel.', status: 404 };
  const { cancelBookedEvent } = await import('@/services/calendar/bookDemoOnCalendar');
  const { cancelScheduledActions } = await import('@/services/scheduler/cancelScheduledActions');
  if (demo.calendarEventId) {
    try { await cancelBookedEvent(demo); } catch { /* the booking still has to be marked cancelled */ }
  }
  demo.status = 'Cancelled';
  await demo.save();
  await cancelScheduledActions(loaded.lead._id, 'inbox-demo-cancelled');
  logLeadEvent('DEMO_CANCELLED', { bookingId: String(demo._id), source: 'inbox' }, userId, { leadId: loaded.lead._id, phone: loaded.lead.phone });
  return { ok: true as const };
}

export async function getInboxSettings() {
  await dbConnect();
  const settings = await humanInboxSettings();
  return {
    ...settings,
    templateAccess: 'Approved notification template only. Template ids stay on the server.',
    attachments: 'Text and approved templates. The inbox does not upload files.',
    access: 'Super Admin',
  };
}

export async function updateInboxSettings(input: { enabled?: boolean; assignOnTakeover?: boolean }) {
  await dbConnect();
  const existing = await SalesAgentConfig.findOne({ key: 'default' }).select('_id');
  if (!existing) return { ok: false as const, error: 'Sales agent configuration does not exist yet.', status: 409 };
  const update: Record<string, boolean> = {};
  if (typeof input.enabled === 'boolean') update.humanInboxEnabled = input.enabled;
  if (typeof input.assignOnTakeover === 'boolean') update.humanInboxAssignOnTakeover = input.assignOnTakeover;
  if (Object.keys(update).length) await SalesAgentConfig.updateOne({ key: 'default' }, { $set: update });
  return { ok: true as const, settings: await humanInboxSettings() };
}

export function inboxTemplates() {
  return [
    { key: 'notification', name: 'GrowwMatics update', configured: Boolean(WA_TEMPLATES.notification), variables: ['name', 'message'] },
  ];
}


/** Chats with a message nobody has opened yet — the Inbox badge in the menu. */
export async function inboxUnreadCount(): Promise<{ unread: number }> {
  await dbConnect();
  await ensureThreadsBackfilled();
  const unread = await WhatsAppThread.countDocuments({
    lastInboundAt: { $ne: null },
    $or: [{ lastReadAt: null }, { $expr: { $gt: ['$lastInboundAt', '$lastReadAt'] } }],
  });
  return { unread };
}
