import dbConnect from '@/lib/mongodb';
import SupportConversation from '@/models/SupportConversation';
import Lead from '@/models/Lead';
import User from '@/models/User';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { SUPPORT_MESSAGE } from '@/lib/whatsappCta';

/**
 * Minimal support intake on the Growwmatics platform WhatsApp line (Segment 4A).
 *
 *  - Deterministic: no AI call, no troubleshooting, no sales content.
 *  - One issue = one active SupportConversation per number. Messages within
 *    SUPPORT_ISSUE_IDLE_DAYS of the last activity belong to it; an older one
 *    is closed as idle when the next message arrives (no cron), and the next
 *    message opens a new issue.
 *  - One acknowledgement per issue (SUPPORT_ACK_MESSAGE), claimed atomically
 *    on the conversation before sending and released if the send fails, so a
 *    retry, a redelivery or a second message never sends it twice.
 *  - No acknowledgement to a number that opted out, or while a human owns the
 *    conversation; the message is still captured for the team.
 *  - Sender context is recorded for the team (user / workspace), with
 *    senderVerified=false when it comes from an unverified phone match.
 */

export const SUPPORT_ACK_MESSAGE =
  "Thank you for contacting Growwmatics. We've received your message. Our support team will review your concern and get back to you shortly.";
export const SUPPORT_ISSUE_IDLE_DAYS = 7;

export type SupportMatch = 'verified_user' | 'paying_customer' | 'support_request' | 'sales_handoff';

const NOT_A_SUPPORT_REQUEST = /\b(no|not an?|any) (problem|issue|worries|trouble)s?\b|\bno need (for|of) help\b/i;
const SUPPORT_PATTERNS: RegExp[] = [
  /\b(support|customer care|helpdesk|help desk|complaint|complain)\b/i,
  /^\s*help\b/i,
  /\b(need|want|require|please)\s+(some\s+|your\s+)?help\b/i,
  /\bhelp\s+(me|us|with|needed|please)\b/i,
  /\bnot working\b|\bdoesn'?t work\b|\bisn'?t working\b|\bstopped working\b/i,
  /\b(issue|problem|trouble|error|bug)\s+(with|in|on|while|when|logging|login|connecting)\b/i,
  /\b(i have|i've got|i got|i'm having|im having|having|facing)\s+(an?\s+|some\s+)?(issue|problem|trouble|error)s?\b/i,
  /\bcan'?t\s+(log ?in|sign ?in|access|connect|see|open)\b|\bunable to\s+(log ?in|sign ?in|access|connect|see|open)\b/i,
];

/**
 * A message that clearly asks for help. Strict on purpose: it can take a
 * message away from an active sales / demo / report conversation, so
 * "no problem, 3pm works" or "any issue with Tuesday?" must not match.
 */
export function isExplicitSupportRequest(body: string | null | undefined): boolean {
  const text = (body || '').trim();
  if (!text) return false;
  if (text.toLowerCase() === SUPPORT_MESSAGE.toLowerCase()) return true;
  if (NOT_A_SUPPORT_REQUEST.test(text)) return false;
  return SUPPORT_PATTERNS.some((re) => re.test(text));
}

/**
 * Who is writing, as far as this line can tell. A verified Growwmatics user;
 * or a paying / trial workspace found by this phone (owner phone not
 * verified — context is recorded but flagged unverified); or a platform Lead
 * already marked a customer by payment. Otherwise not a known customer.
 */
export async function identifySupportSender(phone: string): Promise<{ customer: boolean; match?: SupportMatch; senderVerified: boolean; userId?: unknown; businessId?: unknown }> {
  await dbConnect();
  const e164 = normalizePhoneE164(phone) || phone;
  const user: any = await User.findOne({ phone: { $in: [...new Set([e164, phone])] } })
    .select('_id activeBusinessId isPhoneVerified').sort({ isPhoneVerified: -1 }).lean();
  if (user?.isPhoneVerified) return { customer: true, match: 'verified_user', senderVerified: true, userId: user._id, businessId: user.activeBusinessId };
  const { trialOrPaidForPhone } = await import('@/services/sales/preSalesPolicy');
  if (await trialOrPaidForPhone(e164)) {
    return { customer: true, match: 'paying_customer', senderVerified: false, userId: user?._id, businessId: user?.activeBusinessId };
  }
  const lead: any = await Lead.findOne({ phone: e164, tenantId: 'gmbboost-internal' }).select('currentStage').lean();
  if (lead && (lead.currentStage === 'CUSTOMER' || lead.currentStage === 'PAYMENT_VERIFIED')) {
    return { customer: true, match: 'paying_customer', senderVerified: false, userId: user?._id, businessId: user?.activeBusinessId };
  }
  return { customer: false, senderVerified: false };
}

/** The ongoing issue for this number, or null. An active issue idle past the window is closed here. */
export async function findOngoingSupportIssue(phone: string, now = new Date()): Promise<any | null> {
  await dbConnect();
  const phoneKey = phoneDedupeKey(phone);
  if (!phoneKey) return null;
  const cutoff = new Date(now.getTime() - SUPPORT_ISSUE_IDLE_DAYS * 86_400_000);
  await SupportConversation.updateMany(
    { phoneKey, status: 'active', updatedAt: { $lt: cutoff } },
    { $set: { status: 'closed', closedAt: now, closedReason: 'idle' } },
    { timestamps: false }
  );
  return SupportConversation.findOne({ phoneKey, status: 'active' }).sort({ updatedAt: -1 });
}

/** On STOP: every open issue for this number is closed (captured messages stay for the team). */
export async function closeSupportIssuesOnOptOut(phone: string, now = new Date()): Promise<void> {
  const phoneKey = phoneDedupeKey(phone);
  if (!phoneKey) return;
  await SupportConversation.updateMany({ phoneKey, status: 'active' }, { $set: { status: 'closed', closedAt: now, closedReason: 'opt_out' } });
}

/**
 * Sends the one acknowledgement for this issue if it has not gone out yet and
 * may go out. Returns what happened. Never throws.
 */
export async function acknowledgeSupportIssue(conversationId: unknown, now = new Date()): Promise<'sent' | 'already_sent' | 'skipped_opted_out' | 'skipped_human' | 'failed' | 'not_found'> {
  try {
    await dbConnect();
    const convo: any = await SupportConversation.findById(conversationId).select('leadPhone leadName status ackSentAt aiEnabled messages.role').lean();
    if (!convo || convo.status !== 'active') return 'not_found';
    if (convo.ackSentAt) return 'already_sent';
    // An issue opened before Segment 4A was already answered by the old agent: no second reply.
    if ((convo.messages || []).some((m: any) => m.role === 'agent')) {
      await SupportConversation.updateOne({ _id: conversationId, ackSentAt: { $exists: false } }, { $set: { ackSentAt: now } });
      return 'already_sent';
    }
    if (convo.aiEnabled === false) return 'skipped_human';
    const lead: any = await Lead.findOne({ phone: normalizePhoneE164(convo.leadPhone) || convo.leadPhone, tenantId: 'gmbboost-internal' })
      .select('_id nurtureStatus currentStage currentAgent humanHandoff').lean();
    if (lead?.nurtureStatus === 'OPTED_OUT' || lead?.currentStage === 'DO_NOT_CONTACT') return 'skipped_opted_out';
    const { isHumanOwned } = await import('@/services/agentHandoff/isHumanOwned');
    if (isHumanOwned(lead)) return 'skipped_human';

    const claimed = await SupportConversation.findOneAndUpdate(
      { _id: conversationId, status: 'active', ackSentAt: { $exists: false } },
      { $set: { ackSentAt: now } },
      { projection: { _id: 1 } }
    ).lean();
    if (!claimed) return 'already_sent';

    const { sendOutboundMessage } = await import('@/services/whatsapp/send');
    const res = await sendOutboundMessage(convo.leadPhone, SUPPORT_ACK_MESSAGE, lead?._id ? String(lead._id) : undefined, undefined, undefined, (convo.leadName || '').trim() || 'there');
    if (!res.success) {
      await SupportConversation.updateOne({ _id: conversationId, ackSentAt: now }, { $unset: { ackSentAt: '' } });
      console.warn(`[supportIntake] acknowledgement for ${conversationId} failed: ${res.error}`);
      return 'failed';
    }
    await SupportConversation.updateOne({ _id: conversationId }, { $push: { messages: { role: 'agent', text: SUPPORT_ACK_MESSAGE, at: new Date() } } });
    const { logLeadEvent } = await import('@/services/leadEvents');
    logLeadEvent('MESSAGE_SENT', { channel: 'whatsapp', acknowledgment: true, source: 'SUPPORT_INTAKE' }, 'support-intake', {
      ...(lead?._id ? { leadId: lead._id } : {}), phone: convo.leadPhone, conversationType: 'support', conversationId: convo._id,
    });
    return 'sent';
  } catch (err: any) {
    console.error('[supportIntake] acknowledgement error:', err?.message);
    return 'failed';
  }
}

/**
 * Captures one inbound support message: appended to the ongoing issue, or a
 * new issue is opened (with sender context). Then the issue is acknowledged
 * once — a later message only retries an acknowledgement that never went out.
 */
export async function captureSupportMessage(input: {
  phone: string;
  profileName?: string;
  body: string;
  match: SupportMatch;
  sender?: { senderVerified?: boolean; userId?: unknown; businessId?: unknown };
  now?: Date;
}): Promise<{ conversationId: string; created: boolean; acknowledgement: Awaited<ReturnType<typeof acknowledgeSupportIssue>> }> {
  await dbConnect();
  const now = input.now || new Date();
  const line = { role: 'lead' as const, text: input.body || '', at: now, via: 'whatsapp' };
  const ongoing = await findOngoingSupportIssue(input.phone, now);
  let conversationId: string;
  let created = false;
  if (ongoing) {
    await SupportConversation.updateOne({ _id: ongoing._id }, { $push: { messages: line } });
    conversationId = String(ongoing._id);
  } else {
    const convo = await SupportConversation.create({
      leadPhone: normalizePhoneE164(input.phone) || input.phone,
      phoneKey: phoneDedupeKey(input.phone),
      leadName: input.profileName || '',
      status: 'active',
      messages: [line],
      matchedBy: input.match,
      senderVerified: !!input.sender?.senderVerified,
      ...(input.sender?.userId ? { userId: input.sender.userId } : {}),
      ...(input.sender?.businessId ? { businessId: input.sender.businessId } : {}),
    });
    conversationId = String(convo._id);
    created = true;
    // A new issue reaches the team at once — it is waiting in the WhatsApp Inbox.
    try {
      const { sendPushToSuperAdmins } = await import('@/services/push');
      await sendPushToSuperAdmins({
        title: input.match === 'support_request' ? 'New support request' : 'Support request from a customer',
        body: `${input.profileName || input.phone}: ${(input.body || '').slice(0, 120)}`,
        data: { url: '/admin/inbox' },
      });
    } catch (err: any) {
      console.warn('[supportIntake] team notification failed:', err?.message);
    }
  }
  const acknowledgement = await acknowledgeSupportIssue(conversationId, now);
  return { conversationId, created, acknowledgement };
}
