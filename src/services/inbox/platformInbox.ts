import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import SalesConversation from '@/models/SalesConversation';
import BookingConversation from '@/models/BookingConversation';
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

function ref(kind: 'sales' | 'booking', id: string): string {
  return `${kind}:${id}`;
}

function parseRef(value: string): { kind: 'sales' | 'booking'; id: string } | null {
  const [kind, id] = value.split(':');
  if ((kind !== 'sales' && kind !== 'booking') || !mongoose.Types.ObjectId.isValid(id || '')) return null;
  return { kind, id };
}

async function leadByPhone(phone: string) {
  const normalized = normalizePhoneE164(phone) || phone;
  return Lead.findOne({ phone: normalized, tenantId: PLATFORM }).lean() as Promise<any>;
}

function preview(messages: any[]): string {
  const last = messages?.[messages.length - 1];
  return last?.text ? String(last.text).slice(0, 90) : '';
}

function unread(convo: any): boolean {
  if (!convo?.lastLeadReplyAt && !(convo?.messages || []).some((m: any) => m.role === 'lead')) return false;
  const inbound = convo.lastLeadReplyAt || [...(convo.messages || [])].reverse().find((m: any) => m.role === 'lead')?.at;
  if (!inbound) return false;
  if (!convo.lastReadAt) return true;
  return new Date(inbound).getTime() > new Date(convo.lastReadAt).getTime();
}

function card(kind: 'sales' | 'booking', convo: any, lead: any) {
  const view = {
    currentAgent: lead?.currentAgent,
    currentStage: lead?.currentStage,
    intent: lead?.intent,
    nurtureStatus: lead?.nurtureStatus,
    humanHandoffActive: !!lead?.humanHandoff?.active,
    assignedUserId: lead?.assignedUserId ? String(lead.assignedUserId) : lead?.humanHandoff?.assignedUserId ? String(lead.humanHandoff.assignedUserId) : null,
    leadScore: typeof lead?.leadScore === 'number' ? lead.leadScore : 0,
    unread: unread(convo),
    status: convo.status,
  };
  return {
    id: ref(kind, String(convo._id)),
    name: lead?.name || convo.leadName || 'Unknown',
    phone: convo.leadPhone,
    preview: preview(convo.messages),
    updatedAt: convo.updatedAt,
    unread: view.unread,
    leadScore: view.leadScore,
    band: scoreBand(view.leadScore),
    intent: lead?.intent || null,
    ownership: ownershipLabel(view, convo.status),
    status: convo.status,
    assignedUserId: view.assignedUserId,
    leadId: lead?._id ? String(lead._id) : null,
    filterView: view,
  };
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

export async function listInbox(input: { q?: string; filter?: string; sort?: string; viewerUserId?: string }) {
  await dbConnect();
  const filter = (input.filter || 'all') as InboxFilter;
  const q = (input.q || '').trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const leadMatch: any[] = [];
  if (rx) leadMatch.push({ name: rx }, { phone: rx }, { email: rx });
  if (q && mongoose.Types.ObjectId.isValid(q)) leadMatch.push({ _id: q });
  const matchedLeads = leadMatch.length
    ? await Lead.find({ tenantId: PLATFORM, $or: leadMatch }).select('phone').limit(40).lean()
    : [];
  const extraPhones = (matchedLeads as any[]).map((lead) => lead.phone).filter(Boolean);
  const textQuery = rx ? { $or: [{ leadName: rx }, { leadPhone: rx }, { 'messages.text': rx }, ...(extraPhones.length ? [{ leadPhone: { $in: extraPhones } }] : [])] } : {};
  const sales = await SalesConversation.find(textQuery).sort({ updatedAt: -1 }).limit(80).select('leadName leadPhone status updatedAt lastLeadReplyAt lastReadAt messages').lean();
  const booking = await BookingConversation.find(rx ? textQuery : { status: { $in: ['active', 'awaiting_slot_selection', 'booked'] } })
    .sort({ updatedAt: -1 }).limit(40).select('leadName leadPhone status updatedAt messages').lean();

  const phones = new Set<string>();
  for (const row of [...sales, ...booking] as any[]) phones.add(row.leadPhone);
  const leads = await Lead.find({ tenantId: PLATFORM, phone: { $in: [...phones] } })
    .select('name phone email leadScore intent currentStage currentAgent nurtureStatus humanHandoff assignedUserId nextBestAction painPoints objections buyingSignals businessProfile tags notes createdAt businessId')
    .lean();
  const byPhone = new Map((leads as any[]).map((lead) => [lead.phone, lead]));

  const latestByPhone = new Map<string, ReturnType<typeof card>>();
  for (const row of [
    ...(sales as any[]).map((convo) => card('sales', convo, byPhone.get(convo.leadPhone))),
    ...(booking as any[]).map((convo) => card('booking', convo, byPhone.get(convo.leadPhone))),
  ]) {
    const prev = latestByPhone.get(row.phone);
    if (!prev || +new Date(row.updatedAt) > +new Date(prev.updatedAt)) latestByPhone.set(row.phone, row);
  }
  let rows = [...latestByPhone.values()];
  if (q && mongoose.Types.ObjectId.isValid(q)) {
    rows = rows.filter((row) => row.leadId === q || row.id.endsWith(q));
  }
  const visible = rows.filter((row) => matchesInboxFilter(row.filterView, filter, input.viewerUserId));
  if (input.sort === 'unread') visible.sort((a, b) => Number(b.unread) - Number(a.unread) || +new Date(b.updatedAt) - +new Date(a.updatedAt));
  else if (input.sort === 'score') visible.sort((a, b) => b.leadScore - a.leadScore);
  else if (input.sort === 'human') visible.sort((a, b) => Number(b.ownership === 'Human Owned') - Number(a.ownership === 'Human Owned') || +new Date(b.updatedAt) - +new Date(a.updatedAt));
  else if (input.sort === 'mine') visible.sort((a, b) => Number(b.assignedUserId === input.viewerUserId) - Number(a.assignedUserId === input.viewerUserId) || +new Date(b.updatedAt) - +new Date(a.updatedAt));
  else visible.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [failedMessages, demoToday] = await Promise.all([
    MessageQueue.countDocuments({ direction: 'OUTBOUND', status: 'FAILED', createdAt: { $gte: since } }),
    DemoBooking.countDocuments({ status: { $in: ['Pending', 'Confirmed'] }, date: kolkataDate() }),
  ]);
  const counts = {
    unread: rows.filter((row) => row.unread).length,
    human: rows.filter((row) => row.ownership === 'Human Owned').length,
    mine: rows.filter((row) => row.assignedUserId === input.viewerUserId).length,
    highIntent: rows.filter((row) => row.leadScore >= 51).length,
    demoToday,
    failedMessages,
  };
  return { conversations: visible.map(({ filterView: _view, ...row }) => row), counts };
}

export async function inboxDetail(conversationRef: string) {
  await dbConnect();
  const parsed = parseRef(conversationRef);
  if (!parsed) return null;
  const Model = parsed.kind === 'sales' ? SalesConversation : BookingConversation;
  const convo: any = await Model.findById(parsed.id);
  if (!convo) return null;
  convo.lastReadAt = new Date();
  await convo.save();

  const lead = await leadByPhone(convo.leadPhone);
  const events = lead
    ? await LeadEvent.find({ $or: [{ leadId: lead._id }, { phone: convo.leadPhone }] }).sort({ createdAt: -1 }).limit(40).lean()
    : [];
  const demo = lead ? await DemoBooking.findOne({ leadId: lead._id }).sort({ updatedAt: -1 }).lean() as any : null;
  const reminders = demo
    ? await ScheduledAction.find({ leadId: lead._id, actionType: 'DEMO_REMINDER', 'payload.bookingId': String(demo._id) }).select('status payload').lean()
    : [];
  const business = lead?.businessId
    ? await Business.findById(lead.businessId).select('name subscriptionStatus googleConnected city googleLocationId createdAt').lean() as any
    : null;
  const subscription = lead?.businessId
    ? await Subscription.findOne({ businessId: lead.businessId }).select('planType billingStatus status startDate').lean() as any
    : null;
  const nextAction = lead
    ? await ScheduledAction.findOne({ leadId: lead._id, status: 'PENDING', actionType: { $nin: ['DEMO_REMINDER', 'NO_SHOW_CHECK'] } }).sort({ dueAt: 1 }).select('actionType dueAt reason').lean() as any
    : null;
  const lastInbound = realInboundAtFromMessages(convo.messages, convo.lastLeadReplyAt);
  const view = {
    currentAgent: lead?.currentAgent,
    currentStage: lead?.currentStage,
    intent: lead?.intent,
    nurtureStatus: lead?.nurtureStatus,
    humanHandoffActive: !!lead?.humanHandoff?.active,
  };

  return {
    id: conversationRef,
    windowOpen: sessionWindowOpen(lastInbound),
    blocked: lead ? outboundBlockedReason(lead) : null,
    banner: view.humanHandoffActive || lead?.currentAgent === 'HUMAN'
      ? 'Human is handling this conversation'
      : 'AI Sales Agent is handling this conversation',
    lead: lead ? {
      id: String(lead._id),
      name: lead.name || convo.leadName || null,
      phone: lead.phone,
      email: lead.email || null,
      company: lead.businessProfile?.name || convo.scores?.businessName || null,
      createdAt: lead.createdAt,
      leadScore: lead.leadScore ?? 0,
      band: scoreBand(lead.leadScore ?? 0),
      intent: lead.intent || null,
      stage: lead.currentStage || null,
      nextBestAction: lead.nextBestAction || null,
      ownership: ownershipLabel(view, convo.status),
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
    nurture: parsed.kind === 'sales' ? {
      status: lead?.nurtureStatus || convo.status,
      followUpsSent: convo.followUpsSent || 0,
      version: convo.nurtureConfigVersion || null,
      lastAgentAt: convo.lastAgentAt || null,
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
    messages: (convo.messages || []).map((message: any) => ({
      role: message.role,
      kind: messageKind(message.role, message.sender),
      text: message.text,
      at: message.at,
      clientKey: message.clientKey || null,
    })),
    events: (events as any[]).map((event) => ({
      type: event.type,
      at: event.createdAt,
      actor: event.actor,
      payload: event.payload || {},
    })).reverse(),
  };
}

async function loadConversation(conversationRef: string) {
  const parsed = parseRef(conversationRef);
  if (!parsed) return null;
  const Model = parsed.kind === 'sales' ? SalesConversation : BookingConversation;
  const convo: any = await Model.findById(parsed.id);
  if (!convo) return null;
  const lead = await leadByPhone(convo.leadPhone);
  return { convo, lead, kind: parsed.kind };
}

export async function sendInboxMessage(conversationRef: string, input: { text?: string; template?: string; clientKey?: string }) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded) return { ok: false as const, error: 'Conversation not found', status: 404 };
  const settings = await humanInboxSettings();
  if (!settings.enabled) return { ok: false as const, error: 'Human inbox is disabled.', status: 403 };
  const { convo, lead } = loaded;
  if (lead && outboundBlockedReason(lead)) {
    return { ok: false as const, error: 'This lead cannot be contacted.', status: 409 };
  }
  if (input.clientKey && duplicateClientKey(convo.messages || [], input.clientKey)) {
    return { ok: true as const, duplicate: true };
  }
  const lastInbound = realInboundAtFromMessages(convo.messages, convo.lastLeadReplyAt);
  const open = sessionWindowOpen(lastInbound);
  let text = (input.text || '').trim();
  if (!open && input.template !== 'notification') {
    return { ok: false as const, error: 'WhatsApp customer-service window is closed. Select an approved template to continue.', status: 409 };
  }
  let result;
  if (!open) {
    if (!WA_TEMPLATES.notification) return { ok: false as const, error: 'The notification template is not configured.', status: 409 };
    text = text || 'A GrowwMatics teammate sent you an update.';
    const built = buildNotificationVariables(recipientFirstName(lead?.name || convo.leadName), text);
    if (!built.ok) return { ok: false as const, error: built.error, status: 400 };
    result = await sendTemplateMessage(convo.leadPhone, WA_TEMPLATES.notification, built.variables);
  } else {
    if (!text) return { ok: false as const, error: 'Message is empty.', status: 400 };
    result = await sendOutboundMessage(convo.leadPhone, text, lead?._id?.toString());
  }
  if (!result.success) return { ok: false as const, error: 'Message failed to send', status: 502 };
  convo.messages.push({ role: 'agent', text, at: new Date(), sender: 'human', clientKey: input.clientKey || undefined });
  convo.lastAgentAt = new Date();
  await convo.save();
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

export async function resolveInbox(conversationRef: string, reopen: boolean) {
  await dbConnect();
  const loaded = await loadConversation(conversationRef);
  if (!loaded) return { ok: false as const, error: 'Conversation not found', status: 404 };
  if (reopen) {
    if (loaded.convo.status === 'stopped' && loaded.lead?.nurtureStatus === 'OPTED_OUT') {
      return { ok: false as const, error: 'An opted-out conversation stays closed.', status: 409 };
    }
    loaded.convo.status = 'active';
  } else if (loaded.kind === 'booking' && loaded.convo.status === 'booked') {
    return { ok: false as const, error: 'Cancel the demo before resolving this thread.', status: 409 };
  } else {
    loaded.convo.status = loaded.kind === 'booking' ? 'stopped' : 'completed';
  }
  await loaded.convo.save();
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

